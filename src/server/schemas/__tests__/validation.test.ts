import { describe, it, expect } from "vitest";
import {
  clientLoginSchema,
  clientForgotPasswordSchema,
  clientResetPasswordSchema,
  accountantLoginSchema,
  webhookReceitasSchema,
  clientSetupProfileSchema,
  clientMessageSchema,
  clientPreferencesSchema,
  integrationSyncClientSchema,
  serproConfigSchema,
  docStatusSchema,
  nfseEmitSchema,
} from "../validation";

describe("validation schemas", () => {
  it("clientLoginSchema requires cnpj and password", () => {
    expect(clientLoginSchema.safeParse({ cnpj: "123", password: "x" }).success).toBe(false); // cnpj too short
    expect(clientLoginSchema.safeParse({ cnpj: "12345678901234", password: "x" }).success).toBe(true);
    expect(clientLoginSchema.safeParse({ cnpj: "12345678901234" }).success).toBe(false); // missing password
  });

  it("clientForgotPasswordSchema requires cnpj", () => {
    expect(clientForgotPasswordSchema.safeParse({}).success).toBe(false);
    expect(clientForgotPasswordSchema.safeParse({ cnpj: "12345678901234" }).success).toBe(true);
  });

  it("clientResetPasswordSchema requires cnpj, a 6-digit code, and newPassword >= 8", () => {
    // Regression test: an earlier version of this schema forgot `cnpj`,
    // which would have caused validateBody() to silently strip it from
    // req.body (Zod drops unknown keys by default), breaking the endpoint.
    const result = clientResetPasswordSchema.safeParse({
      cnpj: "12345678901234",
      code: " 123456 ",
      newPassword: "newpass12",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty("cnpj");
      expect(result.data.code).toBe("123456"); // trimmed
    }

    expect(
      clientResetPasswordSchema.safeParse({ code: "123456", newPassword: "newpass12" }).success,
    ).toBe(false); // missing cnpj

    expect(
      clientResetPasswordSchema.safeParse({
        cnpj: "12345678901234",
        code: "12345",
        newPassword: "newpass12",
      }).success,
    ).toBe(false); // code not 6 digits

    expect(
      clientResetPasswordSchema.safeParse({
        cnpj: "12345678901234",
        code: "123456",
        newPassword: "short",
      }).success,
    ).toBe(false); // password too short
  });

  it("accountantLoginSchema requires username and password", () => {
    expect(accountantLoginSchema.safeParse({ username: "admin", password: "x" }).success).toBe(true);
    expect(accountantLoginSchema.safeParse({ username: "" , password: "x" }).success).toBe(false);
  });

  it("webhookReceitasSchema requires hash_empresa but allows optional fields to be absent", () => {
    expect(webhookReceitasSchema.safeParse({ hash_empresa: "abc" }).success).toBe(true);
    expect(webhookReceitasSchema.safeParse({}).success).toBe(false);
  });

  it("clientSetupProfileSchema requires a valid email and a >=8 char password (or blank)", () => {
    expect(clientSetupProfileSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
    expect(clientSetupProfileSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(true);
    expect(clientSetupProfileSchema.safeParse({ email: "a@b.com", password: "longenough" }).success).toBe(true);
    expect(clientSetupProfileSchema.safeParse({ email: "nope", password: "longenough" }).success).toBe(false);
    expect(clientSetupProfileSchema.safeParse({ email: "a@b.com", password: "short" }).success).toBe(false);
  });

  it("clientMessageSchema / docStatusSchema reject empty and overlong input", () => {
    expect(clientMessageSchema.safeParse({ content: "oi" }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ content: "" }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ content: "x".repeat(6000) }).success).toBe(false);
    expect(docStatusSchema.safeParse({ status: "paid" }).success).toBe(true);
    expect(docStatusSchema.safeParse({}).success).toBe(false);
  });

  it("clientPreferencesSchema requires an object of booleans", () => {
    expect(clientPreferencesSchema.safeParse({ notificationPreferences: { on_due: true } }).success).toBe(true);
    expect(clientPreferencesSchema.safeParse({ notificationPreferences: { on_due: "yes" } }).success).toBe(false);
    expect(clientPreferencesSchema.safeParse({}).success).toBe(false);
  });

  it("integrationSyncClientSchema validates cnpj + name and rejects junk regularity", () => {
    expect(integrationSyncClientSchema.safeParse({ cnpj: "12345678000199", name: "ACME" }).success).toBe(true);
    expect(integrationSyncClientSchema.safeParse({ cnpj: "123", name: "ACME" }).success).toBe(false);
    expect(
      integrationSyncClientSchema.safeParse({ cnpj: "12345678000199", name: "ACME", regularityStatus: "purple" }).success,
    ).toBe(false);
  });

  it("serproConfigSchema pins ambiente to trial/producao", () => {
    expect(serproConfigSchema.safeParse({ ambiente: "producao" }).success).toBe(true);
    expect(serproConfigSchema.safeParse({ ambiente: "" }).success).toBe(true);
    expect(serproConfigSchema.safeParse({ ambiente: "prod" }).success).toBe(false);
  });

  describe("nfseEmitSchema — tolera o retorno da consulta de CNPJ", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const base = { atividadeId: uuid, tomador: { doc: "98765432000110", nome: "Tomadora SA" }, descricao: "Serviço", valor: 25000 };

    it("aceita endereço com campos null (BrasilAPI)", () => {
      const r = nfseEmitSchema.safeParse({
        ...base,
        tomador: {
          ...base.tomador,
          email: null,
          telefone: null,
          endereco: { logradouro: "Rua X", numero: null, complemento: null, bairro: "Centro", codigoMunicipio: "3550308", municipio: "São Paulo", uf: "SP", cep: null },
        },
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.tomador.endereco?.numero).toBeUndefined();
        expect(r.data.tomador.email).toBeUndefined();
      }
    });

    it("descarta e-mail malformado em vez de rejeitar", () => {
      const r = nfseEmitSchema.safeParse({ ...base, tomador: { ...base.tomador, email: "FULANO@;GMAIL" } });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.tomador.email).toBeUndefined();
    });

    it("normaliza o documento do tomador (tira pontuação)", () => {
      const r = nfseEmitSchema.safeParse({ ...base, tomador: { ...base.tomador, doc: "98.765.432/0001-10" } });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.tomador.doc).toBe("98765432000110");
    });

    it("ainda exige atividade, nome e valor > 0", () => {
      expect(nfseEmitSchema.safeParse({ ...base, atividadeId: "x" }).success).toBe(false);
      expect(nfseEmitSchema.safeParse({ ...base, valor: 0 }).success).toBe(false);
      expect(nfseEmitSchema.safeParse({ ...base, tomador: { ...base.tomador, nome: "" } }).success).toBe(false);
    });
  });
});
