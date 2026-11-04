import crypto from "crypto";
import jwt from "jsonwebtoken";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db";
import { authSessions } from "../schema";
import { JWT_SECRET } from "../middleware/auth";
import type { AuthPayload } from "../types";

// ---------------------------------------------------------------------------
// Access + refresh sessions.
//
// - Access token: a short-lived (15 min) JWT. Stateless — the API middleware
//   just verifies the signature. A revoked session keeps working until the
//   access token expires; that 15-min window is the accepted trade-off for not
//   hitting the DB on every request.
// - Refresh token: an opaque 256-bit random string, valid ~90 days, stored
//   ONLY as a sha256 digest in auth_sessions. Rotated on every use: each
//   /api/auth/refresh issues a brand-new refresh token and remembers the hash
//   of the one it replaced. Presenting an already-rotated token ("reuse") is a
//   theft signal — the whole session is revoked.
//
// Same mechanism for every platform (browser, PWA, Capacitor); only the client
// side differs in how it stores the two tokens.
// ---------------------------------------------------------------------------

export const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface SessionSubject {
  subjectType: "client" | "accountant";
  subjectId: string; // clients.id for a client; the literal "accountant" otherwise
  name?: string;
  clientId?: string; // set for client sessions (mirrors subjectId)
}

export interface IssuedTokens {
  token: string; // access JWT
  refreshToken: string; // opaque
  expiresIn: number; // access token lifetime, seconds
}

export class RefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshError";
  }
}

function newRefreshToken(): string {
  return "vrt_" + crypto.randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(String(token).trim()).digest("hex");
}

export function signAccessToken(subject: SessionSubject, sid: string): string {
  const payload: AuthPayload = {
    role: subject.subjectType === "accountant" ? "accountant" : "client",
    typ: "access",
    sid,
    ...(subject.name ? { name: subject.name } : {}),
    ...(subject.clientId ? { clientId: subject.clientId } : {}),
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL_SECONDS });
}

// New login → new session row → first access/refresh pair.
export async function createSession(
  subject: SessionSubject,
  userAgent?: string,
): Promise<IssuedTokens> {
  const refreshToken = newRefreshToken();
  const [row] = await db
    .insert(authSessions)
    .values({
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      refreshHash: hashRefreshToken(refreshToken),
      userAgent: (userAgent || "").slice(0, 400) || null,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    })
    .returning();

  return {
    token: signAccessToken(subject, row.id),
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
  };
}

// /api/auth/refresh: validate + rotate. Throws RefreshError on any failure
// (the route maps every RefreshError to one generic 401).
export async function rotateSession(
  refreshToken: string,
  userAgent?: string,
): Promise<IssuedTokens> {
  const presented = hashRefreshToken(refreshToken);

  // Reuse detection: this token was already rotated away from some session.
  const [reused] = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.previousRefreshHash, presented))
    .limit(1);
  if (reused) {
    if (!reused.revokedAt) {
      await db
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(eq(authSessions.id, reused.id));
    }
    throw new RefreshError("refresh token reuse detected");
  }

  const [session] = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.refreshHash, presented))
    .limit(1);
  if (!session) throw new RefreshError("unknown refresh token");
  if (session.revokedAt) throw new RefreshError("session revoked");
  if (session.expiresAt.getTime() < Date.now()) throw new RefreshError("session expired");

  const nextRefresh = newRefreshToken();
  await db
    .update(authSessions)
    .set({
      refreshHash: hashRefreshToken(nextRefresh),
      previousRefreshHash: presented,
      lastUsedAt: new Date(),
      userAgent: (userAgent || session.userAgent || "").slice(0, 400) || null,
    })
    .where(eq(authSessions.id, session.id));

  const subject: SessionSubject = {
    subjectType: session.subjectType as "client" | "accountant",
    subjectId: session.subjectId,
    clientId: session.subjectType === "client" ? session.subjectId : undefined,
  };

  return {
    token: signAccessToken(subject, session.id),
    refreshToken: nextRefresh,
    expiresIn: ACCESS_TTL_SECONDS,
  };
}

// Idempotent — logout. Matches the current refresh hash or the one it was just
// rotated from, so a logout racing a refresh still lands.
export async function revokeSessionByRefreshToken(refreshToken: string): Promise<void> {
  const presented = hashRefreshToken(refreshToken);
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      or(
        eq(authSessions.refreshHash, presented),
        eq(authSessions.previousRefreshHash, presented),
      ),
    );
}

// Kill every session for a subject — used when a client's password is reset
// or the client is deleted.
export async function revokeAllSessionsForSubject(
  subjectType: "client" | "accountant",
  subjectId: string,
): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.subjectType, subjectType), eq(authSessions.subjectId, subjectId)));
}

// Hard-delete a subject's session rows (client deletion cascade).
export async function deleteSessionsForSubject(
  subjectType: "client" | "accountant",
  subjectId: string,
): Promise<void> {
  await db
    .delete(authSessions)
    .where(and(eq(authSessions.subjectType, subjectType), eq(authSessions.subjectId, subjectId)));
}
