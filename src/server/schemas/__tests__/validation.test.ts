import { describe, it, expect } from "vitest";
import {
  clientLoginSchema,
  clientForgotPasswordSchema,
  clientResetPasswordSchema,
  accountantLoginSchema,
  webhookReceitasSchema,
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
});
