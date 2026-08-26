import express from "express";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
// Patches Express so rejected promises in async route handlers are forwarded
// to the error-handling middleware below, instead of becoming unhandled
// rejections that crash the whole process. Must be imported before routes
// are registered.
import "express-async-errors";
import { createServer as createViteServer } from "vite";
import { setupRoutes } from "./src/server/routes";
import { initDb } from "./src/server/db";
import { apiLimiter } from "./src/server/middleware/rateLimit";

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
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
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
