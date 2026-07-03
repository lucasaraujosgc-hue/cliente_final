import express from "express";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
import { createServer as createViteServer } from "vite";
import { setupRoutes } from "./src/server/routes";
import { initDb } from "./src/server/db";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
