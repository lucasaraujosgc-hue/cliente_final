import { describe, it, expect } from "vitest";
import {
  generateIntegrationToken,
  hashIntegrationToken,
  setIntegrationToken,
  clearIntegrationToken,
} from "../integrationToken";

describe("integrationToken", () => {
  it("generates a prefixed, high-entropy, URL-safe token", () => {
    const t = generateIntegrationToken();
    expect(t.startsWith("vic_")).toBe(true);
    expect(t.slice(4)).toMatch(/^[A-Za-z0-9_-]{40,}$/); // base64url of 32 bytes
    const seen = new Set(Array.from({ length: 200 }, () => generateIntegrationToken()));
    expect(seen.size).toBe(200);
  });

  it("hashes to a stable 64-hex sha256 that doesn't contain the token", () => {
    const t = generateIntegrationToken();
    const h = hashIntegrationToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashIntegrationToken(` ${t} `)); // trims
    expect(h).not.toContain(t.slice(4));
  });

  it("setIntegrationToken stores only the digest and clears the plaintext", () => {
    const t = "vic_abc123";
    expect(setIntegrationToken(t)).toEqual({
      integrationHash: null,
      integrationHashDigest: hashIntegrationToken(t),
    });
    expect(clearIntegrationToken()).toEqual({
      integrationHash: null,
      integrationHashDigest: null,
    });
  });
});
