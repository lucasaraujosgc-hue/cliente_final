import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../services/logger";

// Assigns every request a correlation id (honouring an inbound X-Request-Id
// from a trusted proxy, capped in length) and logs one line per completed
// request: method, path, status, duration. `req.id` is also used by the
// central error handler so a 500 log can be tied back to its access-log line.

const SKIP_PATHS = new Set(["/api/health"]);

export function requestLog(req: Request, res: Response, next: NextFunction) {
  const inbound = req.headers["x-request-id"];
  req.id =
    (typeof inbound === "string" && inbound.trim().slice(0, 64)) ||
    crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);

  if (SKIP_PATHS.has(req.path)) return next();

  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    const level =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level](`${req.method} ${req.path} ${res.statusCode}`, {
      reqId: req.id,
      ms,
      ip: req.ip,
    });
  });

  next();
}
