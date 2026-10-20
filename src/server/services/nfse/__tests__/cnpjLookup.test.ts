import { describe, it, expect, vi, afterEach } from "vitest";
import { lookupCnpj } from "../cnpjLookup";

const brasilApiOk = {
  razao_social: "EMPRESA EXEMPLO LTDA",
  nome_fantasia: "Exemplo",
  email: "contato@exemplo.com",
  ddd_telefone_1: "(11) 3322-4455",
  cnae_fiscal: 8650003,
  descricao_situacao_cadastral: "ATIVA",
  descricao_tipo_de_logradouro: "AVENIDA",
  logradouro: "PAULISTA",
  numero: "1000",
  bairro: "BELA VISTA",
  municipio: "SAO PAULO",
  codigo_municipio_ibge: 3550308,
  uf: "SP",
  cep: "01310-100",
};

const receitaWsOk = {
  status: "OK",
  nome: "EMPRESA RECEITA LTDA",
  fantasia: "Receita",
  email: "x@y.com",
  telefone: "(21) 99999-8888",
  atividade_principal: [{ code: "62.01-5-01" }],
  logradouro: "RUA A",
  numero: "10",
  bairro: "CENTRO",
  municipio: "RIO DE JANEIRO",
  uf: "RJ",
  cep: "20000-000",
};

afterEach(() => vi.restoreAllMocks());

describe("lookupCnpj", () => {
  it("rejects an invalid CNPJ before any request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(lookupCnpj("123")).rejects.toThrow(/CNPJ/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normalizes a BrasilAPI response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(brasilApiOk), { status: 200 }),
    );
    const r = await lookupCnpj("11.222.333/0001-81");
    expect(r.fonte).toBe("brasilapi");
    expect(r.razaoSocial).toBe("EMPRESA EXEMPLO LTDA");
    expect(r.telefone).toBe("1133224455");
    expect(r.endereco.codigoMunicipio).toBe("3550308");
    expect(r.endereco.logradouro).toBe("AVENIDA PAULISTA");
    expect(r.endereco.cep).toBe("01310100");
  });

  it("falls back to ReceitaWS when BrasilAPI fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(receitaWsOk), { status: 200 }));
    const r = await lookupCnpj("11222333000182");
    expect(r.fonte).toBe("receitaws");
    expect(r.razaoSocial).toBe("EMPRESA RECEITA LTDA");
    expect(r.endereco.codigoMunicipio).toBeNull();
  });

  it("throws a friendly error when both providers fail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 503 }));
    await expect(lookupCnpj("11222333000183")).rejects.toThrow(/manualmente/i);
  });
});
