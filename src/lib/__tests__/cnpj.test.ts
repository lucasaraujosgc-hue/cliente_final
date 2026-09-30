import { describe, it, expect } from "vitest";
import { normalizeCnpj, formatCnpj, cnpjMatches } from "../cnpj";

describe("normalizeCnpj", () => {
  it("strips all non-digits", () => {
    expect(normalizeCnpj("12.345.678/0001-99")).toBe("12345678000199");
    expect(normalizeCnpj("12345678000199")).toBe("12345678000199");
    expect(normalizeCnpj(" 12 345 ")).toBe("12345");
    expect(normalizeCnpj(null)).toBe("");
  });
});

describe("formatCnpj", () => {
  it("formats 14 digits, leaves everything else alone", () => {
    expect(formatCnpj("12345678000199")).toBe("12.345.678/0001-99");
    expect(formatCnpj("12.345.678/0001-99")).toBe("12.345.678/0001-99");
    expect(formatCnpj("123")).toBe("123");
    expect(formatCnpj("")).toBe("");
  });
});

describe("cnpjMatches", () => {
  const stored = "12345678000199";
  it("matches formatted or unformatted queries and partials", () => {
    expect(cnpjMatches(stored, "")).toBe(true);
    expect(cnpjMatches(stored, "12345678000199")).toBe(true);
    expect(cnpjMatches(stored, "12.345.678/0001-99")).toBe(true);
    expect(cnpjMatches(stored, "12.345")).toBe(true); // matches formatted prefix
    expect(cnpjMatches(stored, "45678")).toBe(true); // digit substring
    expect(cnpjMatches(stored, "99.999")).toBe(false);
  });
});
