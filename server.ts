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

// A dropped Postgres connection makes the pg Pool emit "error"; without a
// listener Node treats it as an uncaughtException and the process dies.
pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error (connection will be retried):", err);
});

// Last-resort safety net: log anything that somehow still slips through
// (e.g. errors thrown outside of an Express request, like in a raw
// setTimeout/setInterval callback that forgot to .catch()). We deliberately
// do NOT call process.exit() here — for a transient failure like a dropped
// DB connection, killing the whole server is far worse than logging it and
// letting the next request try again.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

async function startServer() {
  validateEnv();

  const app = express();

  // Trust N reverse-proxy hops for X-Forwarded-For (see env.trustProxy).
  app.set("trust proxy", trustProxy());
  app.use(
    helmet({
      // Opt-in CSP (CSP_ENABLED=true). The built SPA loads its own JS/CSS from
      // /assets, Google Fonts for the wordmark, and remote images (the favicon
      // lives on virgulacontabil.com.br). 'unsafe-inline' for styles is needed
      // because Tailwind/we inject a few inline style attributes.
      contentSecurityPolicy:
        process.env.CSP_ENABLED === "true"
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'"],
                frameAncestors: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
              },
            }
          : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  const allowedOrigins = corsOrigins();
  app.use(
    cors({
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: true,
    }),
  );
  // Two webhook endpoints accept a base64-encoded file in a JSON body; base64
  // inflates ~33%, so a 10mb file needs ~14mb of JSON. Give ONLY those routes
  // the larger limit (registered before the global parser so it wins), and
  // keep every other endpoint on a tight 2mb limit. The routes still reject
  // decoded files over MAX_UPLOAD_BYTES with a 413.
  const webhookJson = express.json({ limit: "16mb" });
  app.post("/api/webhook/receitas", webhookJson);
  app.post("/api/webhook/documentos", webhookJson);
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
      console.error(`Error handling ${req.method} ${req.path}:`, err);
      if (res.headersSent) return;
      res.status(err?.status || 500).json({
        error:
          process.env.NODE_ENV === "production"
            ? "Erro interno no servidor."
            : err?.message || "Erro interno no servidor.",
      });
    },
  );

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
