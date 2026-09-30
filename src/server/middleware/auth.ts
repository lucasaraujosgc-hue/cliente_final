import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { findClientByIntegrationToken } from "../services/integrationToken";
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

  const client = await findClientByIntegrationToken(token);
  if (!client) {
    return res.status(403).json({ error: "Invalid integration token" });
  }

  // Attach client to request
  req.integrationClient = client;
  next();
}

// Verifies the access-token JWT and, on success, populates req.user. On an
// EXPIRED token it answers 401 with `code: "token_expired"` so the client
// knows to call /api/auth/refresh and retry; any other failure is a plain 401.
function verifyAccessToken(
  req: Request,
  res: Response,
  next: NextFunction,
  allowedRoles: Array<"client" | "accountant">,
) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided", code: "no_token" });

  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch (e: any) {
    if (e?.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expirado.", code: "token_expired" });
    }
    return res.status(401).json({ error: "Token inválido.", code: "invalid_token" });
  }

  if (!payload.role || !allowedRoles.includes(payload.role)) {
    return res.status(403).json({ error: "Acesso negado para este perfil." });
  }

  req.user = payload;
  next();
}

export function verifyClientAuth(req: Request, res: Response, next: NextFunction) {
  return verifyAccessToken(req, res, next, ["client"]);
}

export function verifyAccountantAuth(req: Request, res: Response, next: NextFunction) {
  return verifyAccessToken(req, res, next, ["accountant"]);
}

export function verifyAnyAuth(req: Request, res: Response, next: NextFunction) {
  return verifyAccessToken(req, res, next, ["client", "accountant"]);
}
