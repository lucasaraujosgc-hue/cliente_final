import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validateBody } from "../validate";

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("validateBody middleware", () => {
  const schema = z.object({
    cnpj: z.string().min(11, "CNPJ inválido."),
    password: z.string().min(1, "Senha é obrigatória."),
  });

  it("calls next() and passes through parsed data when the body is valid", () => {
    const req: any = { body: { cnpj: "12345678000199", password: "abc" } };
    const res = mockRes();
    const next = vi.fn();

    validateBody(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.body).toEqual({ cnpj: "12345678000199", password: "abc" });
  });

  it("responds 400 with field-level errors and does not call next() when invalid", () => {
    const req: any = { body: { cnpj: "123" } };
    const res = mockRes();
    const next = vi.fn();

    validateBody(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error).toBeTruthy();
    const fields = payload.details.map((d: any) => d.field);
    expect(fields).toContain("cnpj");
    expect(fields).toContain("password");
  });

  it("strips fields not declared in the schema", () => {
    const req: any = {
      body: { cnpj: "12345678000199", password: "abc", isAdmin: true },
    };
    const res = mockRes();
    const next = vi.fn();

    validateBody(schema)(req, res, next);

    expect(req.body).not.toHaveProperty("isAdmin");
  });
});
