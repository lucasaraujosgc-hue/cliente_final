import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../password";

describe("password service", () => {
  it("hashes a password into a bcrypt hash string", async () => {
    const hash = await hashPassword("mySecret123");
    expect(hash).not.toBe("mySecret123");
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it("verifies a correct password against its bcrypt hash", async () => {
    const hash = await hashPassword("mySecret123");
    const result = await verifyPassword("mySecret123", hash);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(false);
  });

  it("rejects an incorrect password against a bcrypt hash", async () => {
    const hash = await hashPassword("mySecret123");
    const result = await verifyPassword("wrongPassword", hash);
    expect(result.valid).toBe(false);
  });

  it("falls back to plaintext comparison for legacy (non-bcrypt) accounts", async () => {
    // Simulates an old account created before the bcrypt migration, where
    // passwordHash was literally the plaintext password.
    const legacyStored = "12.345.678/0001-99";
    const result = await verifyPassword("12.345.678/0001-99", legacyStored);
    expect(result.valid).toBe(true);
    // Signals to the caller that this account should be upgraded now.
    expect(result.needsRehash).toBe(true);
  });

  it("matches legacy accounts even when digits-only vs formatted CNPJ differ", async () => {
    const legacyStored = "12345678000199";
    const result = await verifyPassword("12.345.678/0001-99", legacyStored);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  it("rejects a wrong password for a legacy plaintext account", async () => {
    const legacyStored = "12.345.678/0001-99";
    const result = await verifyPassword("wrong-password", legacyStored);
    expect(result.valid).toBe(false);
    expect(result.needsRehash).toBe(false);
  });

  it("never treats a bcrypt-shaped stored value as legacy plaintext, even on wrong guess", async () => {
    const hash = await hashPassword("realPassword");
    // An attacker guessing the raw hash string as the password should not
    // accidentally match via the legacy plaintext fallback.
    const result = await verifyPassword(hash, hash);
    expect(result.valid).toBe(false);
  });
});
