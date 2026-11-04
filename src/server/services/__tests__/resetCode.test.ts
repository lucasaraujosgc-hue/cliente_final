import { describe, it, expect, beforeAll } from "vitest";
import {
  generateResetCode,
  hashResetCode,
  verifyResetCode,
  resetCodeExpiry,
  issuedTooRecently,
  RESET_CODE_TTL_MS,
  RESET_CODE_RESEND_COOLDOWN_MS,
} from "../resetCode";

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-reset-code";
});

describe("generateResetCode", () => {
  it("is always 6 numeric digits", () => {
    for (let i = 0; i < 2000; i++) {
      const c = generateResetCode();
      expect(c).toMatch(/^\d{6}$/);
      expect(Number(c)).toBeGreaterThanOrEqual(100000);
      expect(Number(c)).toBeLessThanOrEqual(999999);
    }
  });

  it("does not obviously repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateResetCode()));
    expect(seen.size).toBeGreaterThan(400);
  });
});

describe("hashResetCode / verifyResetCode", () => {
  it("stores a 64-hex sha256, not the code", () => {
    const h = hashResetCode("123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("123456");
  });

  it("verifies the right code and rejects wrong/blank/whitespace variants", () => {
    const h = hashResetCode("456789");
    expect(verifyResetCode("456789", h)).toBe(true);
    expect(verifyResetCode(" 456789 ", h)).toBe(true); // trims
    expect(verifyResetCode("456788", h)).toBe(false);
    expect(verifyResetCode("", h)).toBe(false);
    expect(verifyResetCode("456789", null)).toBe(false);
    expect(verifyResetCode("456789", "not-hex")).toBe(false);
  });

  it("is peppered — a different PASSWORD_RESET_PEPPER changes the hash", () => {
    const a = hashResetCode("111111");
    process.env.PASSWORD_RESET_PEPPER = "an-explicit-different-pepper";
    const b = hashResetCode("111111");
    delete process.env.PASSWORD_RESET_PEPPER;
    expect(a).not.toBe(b);
    // and the plain code never appears in the digest
    expect(a).not.toContain("111111");
  });
});

describe("expiry / resend cooldown", () => {
  it("resetCodeExpiry is TTL in the future", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(resetCodeExpiry(now).getTime()).toBe(now.getTime() + RESET_CODE_TTL_MS);
  });

  it("issuedTooRecently is true right after issue, false once cooldown passes", () => {
    const now = new Date();
    const freshExpiry = new Date(now.getTime() + RESET_CODE_TTL_MS);
    expect(issuedTooRecently(freshExpiry, now)).toBe(true);

    const later = new Date(now.getTime() + RESET_CODE_RESEND_COOLDOWN_MS + 1000);
    expect(issuedTooRecently(freshExpiry, later)).toBe(false);
    expect(issuedTooRecently(null, now)).toBe(false);
  });
});
