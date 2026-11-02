import { describe, it, expect, vi } from "vitest";
import { resolverTomador } from "../tomador";
import { cnpjValido, cpfValido } from "../../../../lib/inscricao";

const atv = { codTributacaoNac: "040803", itemListaServico: "4.08", issRetido: false };
const cadastro = {
  cnpj: "11222333000181",
  razaoSocial: "TOMADORA EXEMPLO LTDA",
  nomeFantasia: null,
  email: null,
  telefone: null,
  cnaePrincipal: null,
  situacao: "ATIVA",
  endereco: { logradouro: "RUA A", numero: null, complemento: null, bairro: "CENTRO", municipio: "SAO PAULO", codigoMunicipio: "3550308", uf: "SP", cep: "01001000" },
  fonte: "brasilapi" as const,
};

describe("dígitos verificadores", () => {
  it("CPF e CNPJ (inclusive alfanumérico — exemplo oficial da Receita)", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjValido("12.ABC.345/01DE-36")).toBe(false);
  });
});

describe("resolverTomador", () => {
  it("sem tomador → null (consumidor não identificado)", async () => {
    expect(await resolverTomador(null, atv)).toBeNull();
    expect(await resolverTomador({ doc: "" }, atv)).toBeNull();
  });

  it("CPF com nome; sem nome é recusado", async () => {
    expect(await resolverTomador({ doc: "52998224725", nome: "Fulano de Tal" }, atv)).toEqual({ doc: "52998224725", nome: "Fulano de Tal" });
    await expect(resolverTomador({ doc: "52998224725" }, atv)).rejects.toMatchObject({ reason: "tomador_nome" });
  });

  it("CNPJ: usa a razão social confirmada na tela, sem endereço", async () => {
    const buscar = vi.fn();
    expect(await resolverTomador({ doc: "11222333000181", nome: "TOMADORA SA" }, atv, buscar)).toEqual({ doc: "11222333000181", nome: "TOMADORA SA", endereco: null });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("CNPJ sem nome: busca a razão social no cadastro", async () => {
    const r = await resolverTomador({ doc: "11222333000181" }, atv, async () => cadastro);
    expect(r).toMatchObject({ nome: "TOMADORA EXEMPLO LTDA", endereco: null });
    await expect(resolverTomador({ doc: "11222333000181" }, atv, async () => Promise.reject(new Error("fora")))).rejects.toMatchObject({ reason: "tomador_nome" });
  });

  it("ISS retido: exige CNPJ e manda o endereço do cadastro (número S/N quando não houver)", async () => {
    const retido = { ...atv, issRetido: true };
    await expect(resolverTomador(null, retido)).rejects.toMatchObject({ reason: "tomador_obrigatorio" });
    await expect(resolverTomador({ doc: "52998224725", nome: "Fulano" }, retido)).rejects.toMatchObject({ reason: "tomador_obrigatorio" });
    const r = await resolverTomador({ doc: "11222333000181", nome: "TOMADORA SA" }, retido, async () => cadastro);
    expect(r?.endereco).toMatchObject({ codigoMunicipio: "3550308", cep: "01001000", numero: "S/N" });
    await expect(resolverTomador({ doc: "11222333000181", nome: "X" }, retido, async () => ({ ...cadastro, endereco: { ...cadastro.endereco, cep: null } }))).rejects.toMatchObject({ reason: "tomador_endereco" });
  });

  it("17.05.01 (mão de obra) também exige o tomador CNPJ", async () => {
    await expect(resolverTomador(null, { codTributacaoNac: "170501", issRetido: false })).rejects.toMatchObject({ reason: "tomador_obrigatorio" });
    await expect(resolverTomador(null, { codTributacaoNac: null, itemListaServico: "17.05", issRetido: false })).rejects.toMatchObject({ reason: "tomador_obrigatorio" });
  });
});
