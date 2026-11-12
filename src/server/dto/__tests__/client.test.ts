import { describe, it, expect } from "vitest";
import { clientSelfDTO, clientAdminDTO, clientIntegrationDTO } from "../client";

const row = {
  id: "c1",
  cnpj: "12.345.678/0001-99",
  name: "ACME",
  passwordHash: "$2b$10$secret",
  regularityStatus: "green",
  email: "a@b.com",
  firstAccessDone: true,
  integrationHash: "legacy-plain",
  integrationHashDigest: "deadbeef",
  accountantCategory: "Simples",
  notificationPreferences: { receives_all: true },
  resetCodeHash: "abc",
  resetCodeExpires: new Date(),
  resetCodeAttempts: 3,
} as any;

const SECRET_KEYS = [
  "passwordHash",
  "integrationHash",
  "integrationHashDigest",
  "resetCodeHash",
  "resetCodeExpires",
  "resetCodeAttempts",
];

describe("client DTOs never leak secrets", () => {
  for (const [name, dto] of Object.entries({
    clientSelfDTO,
    clientAdminDTO,
    clientIntegrationDTO,
  })) {
    it(`${name} omits every secret field`, () => {
      const out = dto(row);
      for (const k of SECRET_KEYS) {
        expect(out).not.toHaveProperty(k);
      }
    });
  }

  it("clientAdminDTO exposes only whether an integration token exists", () => {
    expect(clientAdminDTO(row).hasIntegrationToken).toBe(true);
    expect(clientAdminDTO({ ...row, integrationHash: null, integrationHashDigest: null }).hasIntegrationToken).toBe(false);
  });

  it("clientSelfDTO keeps the fields the portal needs", () => {
    const out = clientSelfDTO(row);
    expect(out).toMatchObject({
      id: "c1",
      cnpj: "12.345.678/0001-99",
      name: "ACME",
      email: "a@b.com",
      regularityStatus: "green",
      firstAccessDone: true,
      notificationPreferences: { receives_all: true },
    });
  });
});
