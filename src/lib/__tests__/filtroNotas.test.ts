import { describe, it, expect } from "vitest";
import { FILTRO_VAZIO, filtrarNotas, nomeArquivoNfse, paginar, reaisParaCentavos } from "../filtroNotas";

const notas = [
  { id: "1", tomadorNome: "Clínica São José", tomadorDoc: "11222333000181", dataEmissao: "2026-10-05T10:00:00-03:00", valorServicos: 25000, numeroNota: "41" },
  { id: "2", tomadorNome: "Padaria do Zé", tomadorDoc: "52998224725", dataEmissao: "2026-10-20T15:00:00-03:00", valorServicos: 180000, numeroNota: "42" },
  { id: "3", tomadorNome: null, tomadorDoc: null, dataEmissao: "2026-11-02T09:00:00-03:00", valorServicos: 18000, numeroNota: "43" },
];

describe("filtrarNotas", () => {
  it("por nome do tomador, sem diferenciar acento e maiúsculas", () => {
    expect(filtrarNotas(notas, { ...FILTRO_VAZIO, texto: "clinica sao" }).map((n) => n.id)).toEqual(["1"]);
    expect(filtrarNotas(notas, { ...FILTRO_VAZIO, texto: "sem tomador" }).map((n) => n.id)).toEqual(["3"]);
  });
  it("por CPF/CNPJ (com ou sem pontuação)", () => {
    expect(filtrarNotas(notas, { ...FILTRO_VAZIO, texto: "529.982" }).map((n) => n.id)).toEqual(["2"]);
  });
  it("por período de emissão (inclusive)", () => {
    expect(filtrarNotas(notas, { ...FILTRO_VAZIO, de: "2026-10-05", ate: "2026-10-20" }).map((n) => n.id)).toEqual(["1", "2"]);
    expect(filtrarNotas(notas, { ...FILTRO_VAZIO, de: "2026-11-01" }).map((n) => n.id)).toEqual(["3"]);
  });
  it("por faixa de valor em reais", () => {
    expect(filtrarNotas(notas, { ...FILTRO_VAZIO, valorMin: "200", valorMax: "1.800,00" }).map((n) => n.id)).toEqual(["1", "2"]);
    expect(reaisParaCentavos("1.234,56")).toBe(123456);
    expect(reaisParaCentavos("")).toBeNull();
  });
});

describe("paginar (5 por página)", () => {
  it("divide e limita a página", () => {
    const itens = Array.from({ length: 12 }, (_, i) => i);
    expect(paginar(itens, 1)).toMatchObject({ itens: [0, 1, 2, 3, 4], pagina: 1, totalPaginas: 3 });
    expect(paginar(itens, 3).itens).toEqual([10, 11]);
    expect(paginar(itens, 9).pagina).toBe(3);
    expect(paginar([], 1)).toMatchObject({ itens: [], pagina: 1, totalPaginas: 1 });
  });
});

describe("nomeArquivoNfse", () => {
  it("número, tomador e data — sem letras aleatórias", () => {
    expect(nomeArquivoNfse(notas[0])).toBe("NFS-e 41 - Clínica São José - 05-10-2026");
    expect(nomeArquivoNfse(notas[2])).toBe("NFS-e 43 - Sem tomador - 02-11-2026");
    expect(nomeArquivoNfse({ papel: "tomador", prestadorNome: "A/B: Serviços", dataEmissao: "2026-10-01T12:00:00-03:00", numeroNota: "7" })).toBe("NFS-e 7 - A B Serviços - 01-10-2026");
  });
});
