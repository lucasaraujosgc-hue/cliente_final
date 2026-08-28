import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createChallenge,
  verifyChallenge,
  accountantMfaEmail,
  accountantMfaEnabled,
} from "../accountantMfa";

describe("accountantMfa — challenge lifecycle", () => {
  it("issues a unique id + 6-digit code, verifiable exactly once", () => {
    const a = createChallenge();
    const b = createChallenge();
    expect(a.challengeId).not.toBe(b.challengeId);
    expect(a.code).toMatch(/^\d{6}$/);
    expect(a.cooldown).toBe(false);

    expect(verifyChallenge(a.challengeId, a.code)).toBe("ok");
    // single use — gone now
    expect(verifyChallenge(a.challengeId, a.code)).toBe("invalid");
  });

  it("rejects a wrong code and burns the challenge after 5 attempts", () => {
    const c = createChallenge();
    for (let i = 0; i < 5; i++) {
      expect(verifyChallenge(c.challengeId, "000000")).toBe("invalid");
    }
    // 6th attempt: challenge is burned
    expect(verifyChallenge(c.challengeId, c.code)).toBe("too_many_attempts");
  });

  it("returns invalid for an unknown challenge id", () => {
    expect(verifyChallenge("nope", "123456")).toBe("invalid");
  });

  it("resend within the cooldown keeps the same challenge and sends no new code", () => {
    const first = createChallenge();
    const resent = createChallenge(first.challengeId);
    expect(resent.challengeId).toBe(first.challengeId);
    expect(resent.cooldown).toBe(true);
    expect(resent.code).toBe("");
    // original code still valid
    expect(verifyChallenge(first.challengeId, first.code)).toBe("ok");
  });
});

describe("accountantMfa — env gating", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.ACCOUNTANT_2FA;
    delete process.env.ACCOUNTANT_MFA_EMAIL;
    delete process.env.EMAIL_USER;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is off with no address", () => {
    expect(accountantMfaEmail()).toBeNull();
    expect(accountantMfaEnabled()).toBe(false);
  });

  it("uses ACCOUNTANT_MFA_EMAIL, falling back to EMAIL_USER", () => {
    process.env.EMAIL_USER = "fallback@x.com";
    expect(accountantMfaEmail()).toBe("fallback@x.com");
    process.env.ACCOUNTANT_MFA_EMAIL = "primary@x.com";
    expect(accountantMfaEmail()).toBe("primary@x.com");
  });

  it("ACCOUNTANT_2FA=off disables it even with an address set", () => {
    process.env.ACCOUNTANT_MFA_EMAIL = "primary@x.com";
    process.env.ACCOUNTANT_2FA = "off";
    expect(accountantMfaEnabled()).toBe(false);
  });
});
