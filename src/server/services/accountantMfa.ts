import crypto from "crypto";
import { generateResetCode, hashResetCode } from "./resetCode";

// Second factor for the single accountant account: after username+password, a
// 6-digit code is emailed and must be confirmed at /api/auth/accountant/verify.
//
// The pending challenge lives in memory only — there is exactly one accountant,
// the code expires in 10 minutes, and the process is single-instance. A server
// restart mid-login just means the accountant requests a new code. This keeps
// it off the database (no extra table/migration).

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
// Don't send a fresh code while one this recent is still valid (anti-bombing).
const RESEND_COOLDOWN_MS = 60 * 1000;

interface Challenge {
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

const challenges = new Map<string, Challenge>();

function sweep() {
  const now = Date.now();
  for (const [id, c] of challenges) {
    if (c.expiresAt <= now) challenges.delete(id);
  }
}
setInterval(sweep, 5 * 60 * 1000).unref();

export interface CreatedChallenge {
  challengeId: string;
  code: string; // caller emails this; it is never stored in the clear
  cooldown: boolean; // true => an existing valid code is being resent too soon
}

export function createChallenge(existingChallengeId?: string): CreatedChallenge {
  sweep();

  // Resend within the cooldown window: keep the same code/challenge.
  if (existingChallengeId) {
    const prev = challenges.get(existingChallengeId);
    if (prev && Date.now() - prev.createdAt < RESEND_COOLDOWN_MS) {
      return { challengeId: existingChallengeId, code: "", cooldown: true };
    }
  }

  const challengeId = crypto.randomUUID();
  const code = generateResetCode();
  challenges.set(challengeId, {
    codeHash: hashResetCode(code),
    createdAt: Date.now(),
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
    attempts: 0,
  });
  return { challengeId, code, cooldown: false };
}

export type VerifyResult = "ok" | "invalid" | "expired" | "too_many_attempts";

export function verifyChallenge(challengeId: string, code: string): VerifyResult {
  const c = challenges.get(challengeId);
  if (!c) return "invalid";
  if (c.expiresAt <= Date.now()) {
    challenges.delete(challengeId);
    return "expired";
  }
  if (c.attempts >= MAX_ATTEMPTS) {
    challenges.delete(challengeId);
    return "too_many_attempts";
  }

  const expected = Buffer.from(c.codeHash, "hex");
  const got = Buffer.from(hashResetCode(String(code).trim()), "hex");
  const match = expected.length === got.length && crypto.timingSafeEqual(expected, got);

  if (!match) {
    c.attempts++;
    return "invalid";
  }

  challenges.delete(challengeId); // single use
  return "ok";
}

export function pendingChallengeCount(): number {
  return challenges.size;
}

// Where the accountant's 2FA code is emailed, or null when 2FA is off
// (explicit ACCOUNTANT_2FA=off, or no address to send to). env.ts surfaces a
// boot warning when it ends up off by accident.
export function accountantMfaEmail(): string | null {
  if (String(process.env.ACCOUNTANT_2FA || "").toLowerCase() === "off") return null;
  const email = process.env.ACCOUNTANT_MFA_EMAIL || process.env.EMAIL_USER || "";
  return email.includes("@") ? email : null;
}

export function accountantMfaEnabled(): boolean {
  return accountantMfaEmail() !== null;
}
