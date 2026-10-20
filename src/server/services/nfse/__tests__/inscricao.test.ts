import { describe, it, expect } from "vitest";
import {
  normalizeInscricao,
  isCnpj,
  isCpf,
  tipoInscricao,
  inscricaoRaiz,
  inscricaoRaizMatches,
  inscricaoParaId,
  isChaveAcesso,
} from "../inscricao";

describe("normalizeInscricao", () => {
  it("mantém só [0-9A-Z] e sobe para maiúsculas", () => {
    expect(normalizeInscricao("12.345.678/0001-99")).toBe("12345678000199");
    expect(normalizeInscricao("12abc678/0001-99")).toBe("12ABC678000199");
    expect(normalizeInscricao(null)).toBe("");
  });
});

describe("isCnpj / isCpf / tipoInscricao", () => {
  it("aceita CNPJ numérico e alfanumérico (NT-009)", () => {
    expect(isCnpj("12345678000199")).toBe(true);
    expect(isCnpj("12ABC678000D99")).toBe(true);
    expect(isCnpj("123456789")).toBe(false);
  });
  it("CPF é sempre 11 dígitos", () => {
    expect(isCpf("12345678909")).toBe(true);
    expect(isCpf("1234567890A")).toBe(false);
  });
  it("tipoInscricao: 1 = CPF, 2 = CNPJ", () => {
    expect(tipoInscricao("12345678909")).toBe("1");
    expect(tipoInscricao("12ABC678000D99")).toBe("2");
  });
});

describe("raiz da inscrição", () => {
  it("raiz = 8 primeiras posições do CNPJ", () => {
    expect(inscricaoRaiz("12ABC678000199")).toBe("12ABC678");
    expect(inscricaoRaizMatches("12ABC678000199", "12.ABC.678/0002-70")).toBe(true);
    expect(inscricaoRaizMatches("12ABC678000199", "99999999000199")).toBe(false);
  });
  it("CPF completa com 000 à esquerda no Id", () => {
    expect(inscricaoParaId("12345678909")).toBe("00012345678909");
    expect(inscricaoParaId("12ABC678000199")).toBe("12ABC678000199");
  });
});

describe("isChaveAcesso", () => {
  it("50 posições: 6 num + 14 alfanum + 30 num", () => {
    const numerica =
      "3550308" + "2" + "2" + "12345678000199" + "0000000000042" + "2608" + "123456789" + "5";
    expect(numerica).toHaveLength(50);
    expect(isChaveAcesso(numerica)).toBe(true);
    const alfanum = "123456" + "7ABCDEFGH12345" + "6".repeat(30);
    expect(alfanum).toHaveLength(50);
    expect(isChaveAcesso(alfanum)).toBe(true);
    expect(isChaveAcesso("123")).toBe(false);
  });
});
