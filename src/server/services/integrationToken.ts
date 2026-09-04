import crypto from "crypto";
import { eq, or } from "drizzle-orm";
import { db } from "../db";
import { clients } from "../schema";

// Integration tokens authenticate machine callers (the accounting firm's main
// system, webhook providers). They are stored ONLY as a sha256 digest — the
// plaintext is shown once at generation and never again.
//
// TRANSITION: rows created before this change still hold a plaintext value in
// `integration_hash`. `findClientByIntegrationToken` matches the digest first
// and falls back to the legacy plaintext column, so no existing integration
// breaks. Migration 0001 backfills the digest for those rows. A later cleanup
// migration can drop the plaintext column once every integration has re-saved
// or re-generated its token.

export function generateIntegrationToken(): string {
  // URL-safe, 256 bits of entropy, recognisable prefix.
  return "vic_" + crypto.randomBytes(32).toString("base64url");
}

export function hashIntegrationToken(token: string): string {
  return crypto.createHash("sha256").update(String(token).trim()).digest("hex");
}

// Column patch to apply when (re)assigning a token — clears the legacy plaintext.
export function setIntegrationToken(token: string) {
  return {
    integrationHash: null as string | null,
    integrationHashDigest: hashIntegrationToken(token),
  };
}

export function clearIntegrationToken() {
  return {
    integrationHash: null as string | null,
    integrationHashDigest: null as string | null,
  };
}

// The single lookup used by every machine-authenticated entry point.
export async function findClientByIntegrationToken(token: string | undefined | null) {
  if (!token) return undefined;
  const digest = hashIntegrationToken(token);
  const rows = await db
    .select()
    .from(clients)
    .where(or(eq(clients.integrationHashDigest, digest), eq(clients.integrationHash, token)))
    .limit(1);
  return rows[0];
}
