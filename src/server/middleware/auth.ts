import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { clients } from "../schema";
import type { AuthPayload } from "../types";

// In production, env.ts (validateEnv) refuses to boot without a real
// JWT_SECRET, so this fallback only ever applies to local development.
export const JWT_SECRET =
  process.env.JWT_SECRET ||
  "insecure-dev-only-secret-do-not-use-in-production";

export async function verifyIntegrationToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid token" });
  }
  const token = authHeader.split(" ")[1];

  const clientList = await db
    .select()
    .from(clients)
    .where(eq(clients.integrationHash, token));
  if (clientList.length === 0) {
    return res.status(403).json({ error: "Invalid integration token" });
  }

  // Attach client to request
  req.integrationClient = clientList[0];
  next();
}

export function verifyClientAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(" ")[1] || (req.query.token as string);
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.role !== "client") throw new Error("Invalid role");

    // Attach to request
    req.user = payload as AuthPayload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function verifyAccountantAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(" ")[1] || (req.query.token as string);
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.role !== "accountant") throw new Error("Invalid role");
    req.user = payload as AuthPayload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function verifyAnyAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(" ")[1] || (req.query.token as string);
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.role !== "client" && payload.role !== "accountant") throw new Error("Invalid role");
    req.user = payload as AuthPayload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
