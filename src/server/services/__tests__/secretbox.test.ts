import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  encryptBytes,
  decryptBytes,
  secretsEncryptionEnabled,
} from "../secretbox";

const KEY = "test-secrets-key-please-rotate";

describe("secretbox with SECRETS_KEY set", () => {
  beforeEach(() => {
    process.env.SECRETS_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.SECRETS_KEY;
  });

  it("round-trips a string secret and produces the enc:v1 envelope", () => {
    const plain = "serpro-consumer-secret-123";
    const enc = encryptSecret(plain)!;
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("passes null/empty through untouched", () => {
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret("")).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });

  it("still reads a legacy plaintext value (no prefix)", () => {
    expect(decryptSecret("legacy-plaintext")).toBe("legacy-plaintext");
  });

  it("round-trips certificate bytes", () => {
    const pfx = Buffer.from([0x30, 0x82, 0x0a, 0x00, 0xff, 0x00, 0x01]);
    const enc = encryptBytes(pfx);
    expect(enc.equals(pfx)).toBe(false);
    expect(decryptBytes(enc).equals(pfx)).toBe(true);
    // a legacy (unencrypted) file is returned as-is
    expect(decryptBytes(pfx).equals(pfx)).toBe(true);
  });

  it("rejects a tampered ciphertext (GCM auth tag)", () => {
    const enc = encryptSecret("secret")!;
    const parts = enc.split(":");
    parts[4] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("secretsEncryptionEnabled reflects the key", () => {
    expect(secretsEncryptionEnabled()).toBe(true);
  });
});

describe("secretbox without SECRETS_KEY", () => {
  beforeEach(() => {
    delete process.env.SECRETS_KEY;
  });

  it("stores values as-is and can still read them", () => {
    expect(secretsEncryptionEnabled()).toBe(false);
    expect(encryptSecret("plain")).toBe("plain");
    expect(decryptSecret("plain")).toBe("plain");
    const b = Buffer.from("abc");
    expect(encryptBytes(b).equals(b)).toBe(true);
  });
});
