import { describe, it, expect, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../schema";

// Back the session service with an in-memory Postgres (pglite) for the DB-bound
// rotation / reuse-detection / revocation tests.
const pg = new PGlite();
const testDb = drizzle(pg, { schema });
vi.mock("../../db", () => ({ db: testDb, pool: {} }));

const {
  hashRefreshToken,
  signAccessToken,
  ACCESS_TTL_SECONDS,
  createSession,
  rotateSession,
  revokeSessionByRefreshToken,
  revokeAllSessionsForSubject,
  deleteSessionsForSubject,
  RefreshError,
} = await import("../session");
const { JWT_SECRET } = await import("../../middleware/auth");
const { authSessions } = schema;

const AUTH_SESSIONS_DDL = `
CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "refresh_hash" text NOT NULL UNIQUE,
  "previous_refresh_hash" text,
  "user_agent" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "last_used_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz
);`;

// pglite (WASM Postgres) has a slow cold start, worse under parallel workers.
const T = 60_000;

beforeEach(async () => {
  await pg.exec(`DROP TABLE IF EXISTS "auth_sessions"; ${AUTH_SESSIONS_DDL}`);
}, T);

describe("session — pure helpers", () => {
  it("hashRefreshToken is a stable 64-hex sha256 that trims", () => {
    const t = "vrt_" + "a".repeat(43);
    const h = hashRefreshToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(` ${t} `)).toBe(h);
    expect(h).not.toContain(t.slice(4));
  });

  it("signAccessToken produces a verifiable JWT with the expected claims", () => {
    const t = signAccessToken(
      { subjectType: "client", subjectId: "c1", clientId: "c1", name: "ACME" },
      "sid-123",
    );
    const d = jwt.verify(t, JWT_SECRET) as any;
    expect(d).toMatchObject({ role: "client", typ: "access", sid: "sid-123", clientId: "c1", name: "ACME" });
    expect(d.exp - d.iat).toBe(ACCESS_TTL_SECONDS);
  });
});

describe("session — rotation & reuse", { timeout: T }, () => {
  it("creates a session and issues a working access + refresh pair", async () => {
    const { token, refreshToken, expiresIn } = await createSession(
      { subjectType: "client", subjectId: "c1", clientId: "c1", name: "ACME" },
      "vitest-ua",
    );
    expect(refreshToken.startsWith("vrt_")).toBe(true);
    expect(expiresIn).toBe(ACCESS_TTL_SECONDS);
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    expect(decoded.role).toBe("client");
    expect(decoded.clientId).toBe("c1");

    const rows = await testDb.select().from(authSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].refreshHash).toBe(hashRefreshToken(refreshToken));
  });

  it("rotates: old refresh token stops working, new one works", async () => {
    const first = await createSession({ subjectType: "client", subjectId: "c1", clientId: "c1" });
    const second = await rotateSession(first.refreshToken, "ua2");
    expect(second.refreshToken).not.toBe(first.refreshToken);

    // old token is now reuse → session revoked
    await expect(rotateSession(first.refreshToken)).rejects.toBeInstanceOf(RefreshError);

    // and the just-issued token is now dead too (session was revoked)
    await expect(rotateSession(second.refreshToken)).rejects.toBeInstanceOf(RefreshError);
  });

  it("a fresh chain keeps rotating fine", async () => {
    let cur = await createSession({ subjectType: "accountant", subjectId: "accountant", name: "Contador" });
    for (let i = 0; i < 4; i++) {
      cur = await rotateSession(cur.refreshToken);
      const d = jwt.verify(cur.token, JWT_SECRET) as any;
      expect(d.role).toBe("accountant");
    }
  });

  it("rejects an unknown / revoked / expired refresh token", async () => {
    await expect(rotateSession("vrt_nope")).rejects.toBeInstanceOf(RefreshError);

    const s = await createSession({ subjectType: "client", subjectId: "c1", clientId: "c1" });
    await revokeSessionByRefreshToken(s.refreshToken);
    await expect(rotateSession(s.refreshToken)).rejects.toBeInstanceOf(RefreshError);

    const s2 = await createSession({ subjectType: "client", subjectId: "c2", clientId: "c2" });
    await testDb
      .update(authSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authSessions.refreshHash, hashRefreshToken(s2.refreshToken)));
    await expect(rotateSession(s2.refreshToken)).rejects.toBeInstanceOf(RefreshError);
  });

  it("revokeAllSessionsForSubject kills every session of that subject", async () => {
    const a = await createSession({ subjectType: "client", subjectId: "c1", clientId: "c1" });
    const b = await createSession({ subjectType: "client", subjectId: "c1", clientId: "c1" });
    const other = await createSession({ subjectType: "client", subjectId: "c2", clientId: "c2" });

    await revokeAllSessionsForSubject("client", "c1");
    await expect(rotateSession(a.refreshToken)).rejects.toBeInstanceOf(RefreshError);
    await expect(rotateSession(b.refreshToken)).rejects.toBeInstanceOf(RefreshError);
    // unrelated subject still fine
    await expect(rotateSession(other.refreshToken)).resolves.toBeTruthy();
  });

  it("deleteSessionsForSubject removes the rows", async () => {
    await createSession({ subjectType: "client", subjectId: "c1", clientId: "c1" });
    await deleteSessionsForSubject("client", "c1");
    expect(await testDb.select().from(authSessions)).toHaveLength(0);
  });
});
