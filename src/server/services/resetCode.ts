import crypto from "crypto";
import { JWT_SECRET } from "../middleware/auth";

// Password-recovery one-time code.
//
// - 6 numeric digits, generated with crypto.randomInt (CSPRNG), never Math.random
// - only sha256(code + server pepper) is persisted; the code itself is emailed
//   once and never stored or logged
// - short TTL + a hard cap on verification attempts make online brute force of
//   the 10^6 space infeasible; the pepper means a DB-only leak isn't enough
//   either (the app secret is also required)

export const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const RESET_CODE_MAX_ATTEMPTS = 5;
// Don't issue a fresh code (or send another email) while one this recent is
// still outstanding — blunts email bombing of a known client.
export const RESET_CODE_RESEND_COOLDOWN_MS = 60 * 1000;

const PEPPER = () => process.env.PASSWORD_RESET_PEPPER || JWT_SECRET;

export function generateResetCode(): string {
  return String(crypto.randomInt(100000, 1000000)); // 100000–999999, always 6 digits
}

export function hashResetCode(code: string): string {
  return crypto
    .createHash("sha256")
    .update(`${String(code).trim()}:${PEPPER()}`)
    .digest("hex");
}

// Constant-time comparison against the stored hash.
export function verifyResetCode(code: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const candidate = Buffer.from(hashResetCode(code), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

export function resetCodeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_CODE_TTL_MS);
}

// A code counts as "recently sent" (skip resend) if its expiry is still far
// enough in the future.
export function issuedTooRecently(expires: Date | null | undefined, now: Date = new Date()): boolean {
  if (!expires) return false;
  const sentAt = expires.getTime() - RESET_CODE_TTL_MS;
  return now.getTime() - sentAt < RESET_CODE_RESEND_COOLDOWN_MS;
}
