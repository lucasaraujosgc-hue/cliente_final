import express from "express";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
dotenv.config();
import { validateEnv, corsOrigins, PORT } from "./src/server/env";
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

  app.set("trust proxy", 1);
  app.use(
    helmet({
      // The SPA is served from the same origin; a strict CSP would need
      // per-asset tuning with Vite. Keep the other protections on.
      contentSecurityPolicy: false,
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
  // Base64-encoded uploads still flow through some webhook payloads, so the
  // limit can't be tiny, but 50mb per request was an easy memory-exhaustion
  // lever. 12mb comfortably covers the 10mb multipart file cap.
  app.use(express.json({ limit: "12mb" }));
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
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
