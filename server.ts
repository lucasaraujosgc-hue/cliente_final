import type { Server } from "http";
import express from "express";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
dotenv.config();
import { validateEnv, corsOrigins, PORT, trustProxy } from "./src/server/env";
// Patches Express so rejected promises in async route handlers are forwarded
// to the error-handling middleware below, instead of becoming unhandled
// rejections that crash the whole process. Must be imported before routes
// are registered.
import "express-async-errors";
import { createServer as createViteServer } from "vite";
import { setupRoutes } from "./src/server/routes";
import { initDb, pool } from "./src/server/db";
import { apiLimiter } from "./src/server/middleware/rateLimit";
import { requestLog } from "./src/server/middleware/requestLog";
import { inFlightLimit } from "./src/server/middleware/concurrency";
import { logger } from "./src/server/services/logger";

let httpServer: Server | undefined;
let shuttingDown = false;

// A dropped Postgres connection makes the pg Pool emit "error"; without a
// listener Node treats it as an uncaughtException and the process dies.
pool.on("error", (err) => {
  logger.error("Postgres pool error (connection will be retried)", { err: String(err) });
});

// A rejected promise is usually a single bad request, not a corrupted process
// — log it loudly but keep serving.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason: String(reason) });
});

// An uncaught exception leaves the process in an undefined state (leaked
// handles, half-finished work). Log it, stop accepting new connections, give
// in-flight requests a brief grace period, then exit non-zero so the
// orchestrator (Cloud Run / EasyPanel) restarts a clean process.
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception — shutting down", { err: err?.stack || String(err) });
  if (shuttingDown) return;
  shuttingDown = true;
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();
  if (httpServer) {
    httpServer.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

async function startServer() {
  validateEnv();

  const app = express();

  // Trust N reverse-proxy hops for X-Forwarded-For (see env.trustProxy).
  app.set("trust proxy", trustProxy());
  app.use(
    helmet({
      // CSP is ON by default; set CSP_ENABLED=false to disable (e.g. to debug a
      // violation). The built SPA serves its own JS/CSS from /assets (no inline
      // scripts — the module-preload polyfill is off and the SW registers from
      // main.tsx, not an inline tag). Styles need 'unsafe-inline' (Tailwind +
      // a few inline style attributes). Fonts/images: Google Fonts for the
      // wordmark, the favicon on virgulacontabil.com.br. connectSrc includes
      // the absolute API origin the Capacitor build talks to.
      contentSecurityPolicy:
        process.env.CSP_ENABLED === "false"
          ? false
          : {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "https://cliente.virgulacontabil.com.br"],
                workerSrc: ["'self'", "blob:"],
                frameAncestors: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
              },
            },
      crossOriginEmbedderPolicy: false,
    }),
  );

  const allowedOrigins = corsOrigins();
  app.use(
    cors({
      // Explicit allow-list when configured. Otherwise reflect any origin in
      // dev only; in production deny cross-origin outright. validateEnv()
      // already refuses to boot in production without CORS_ORIGINS — this is
      // just a backstop so a misconfig can never open the API to every origin.
      origin:
        allowedOrigins.length > 0
          ? allowedOrigins
          : process.env.NODE_ENV === "production"
            ? false
            : true,
      credentials: true,
    }),
  );

  // Correlation id + access log for every request (before the parsers so even
  // rejected bodies get logged).
  app.use(requestLog);

  // Two webhook endpoints accept a base64-encoded file in a JSON body; base64
  // inflates ~33%, so a 10mb file needs ~14mb of JSON. Give ONLY those routes
  // the larger limit (registered before the global parser so it wins), and
  // keep every other endpoint on a tight 2mb limit. The routes still reject
  // decoded files over MAX_UPLOAD_BYTES with a 413. A shared in-flight cap
  // keeps a burst of large uploads from pinning CPU/memory.
  const webhookJson = express.json({ limit: "16mb" });
  const webhookConcurrency = inFlightLimit(4);
  app.post("/api/webhook/receitas", webhookJson, webhookConcurrency);
  app.post("/api/webhook/documentos", webhookJson, webhookConcurrency);
  app.use(express.json({ limit: "2mb" }));
  // NOTE: /uploads is deliberately NOT served statically. Client documents are
  // private — they're only reachable through the authenticated + authorized
  // endpoint GET /api/documents/:id/file (src/server/routes/files.routes.ts).
  app.use("/uploads", (_req, res) => {
    res.status(404).json({ error: "Recurso indisponível. Use a área autenticada." });
  });
  app.use("/api", apiLimiter);

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Wait for async initialization if needed (e.g. SQLite connection or checking db files)
  await initDb();
  setupRoutes(app);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // SPA Fallback
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Central error handler. Because of express-async-errors above, this also
  // catches errors thrown/rejected inside async route handlers, so a single
  // bad request (e.g. a DB hiccup) returns a 500 to that request instead of
  // taking the whole server down.
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      next: express.NextFunction,
    ) => {
      if (res.headersSent) return;

      // Multer surfaces upload problems (size limit, unexpected field) as a
      // MulterError — client mistakes, not server faults. Answer 4xx quietly.
      if (err?.name === "MulterError") {
        const tooBig = err.code === "LIMIT_FILE_SIZE";
        return res.status(tooBig ? 413 : 400).json({
          error: tooBig
            ? "Arquivo excede o tamanho máximo permitido."
            : "Falha no envio do arquivo.",
        });
      }

      // Errors that explicitly carry a 4xx status (e.g. the upload extension
      // allow-list) are expected and safe to report verbatim.
      const status = Number(err?.status) || 500;
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: err?.message || "Requisição inválida." });
      }

      // Anything else is a real server fault: log it (with the request id so it
      // ties back to the access log), stay generic in prod so internals /
      // stack details never leak.
      logger.error(`Unhandled error on ${req.method} ${req.path}`, {
        reqId: req.id,
        err: err?.stack || String(err),
      });
      res.status(500).json({
        error:
          process.env.NODE_ENV === "production"
            ? "Erro interno no servidor."
            : err?.message || "Erro interno no servidor.",
      });
    },
  );

  httpServer = app.listen(PORT, "0.0.0.0", () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

startServer();
