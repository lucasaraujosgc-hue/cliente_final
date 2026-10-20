import { describe, it, expect } from "vitest";
import {
  avaliarFgts,
  avaliarSitfis,
  competenciaAnterior,
  diaDeSitfis,
  eventosDoDia,
  inferirProcessos,
  lerElementos,
  lerListaNumeros,
  normalizarProcessos,
  piorou,
  piorSituacao,
  type DocGuia,
} from "../regras";
import type { SitfisResultado, SitfisSecao } from "../sitfisParser";
import { tipoGuiaDoDocumento } from "../guias";

const hoje = new Date(2026, 9, 15); // 15/10/2026 → competência 09/2026
const doc = (over: Partial<DocGuia>): DocGuia => ({ category: "FGTS", competence: "09/2026", status: "new", ...over });

describe("competência e situação geral", () => {
  it("competência de referência é o mês anterior", () => {
    expect(competenciaAnterior(hoje)).toBe("09/2026");
    expect(competenciaAnterior(new Date(2026, 0, 10))).toBe("12/2025");
  });

  it("a pior situação prevalece", () => {
    expect(piorSituacao(["em_dia", "pendente", "atencao"])).toBe("atencao");
    expect(piorSituacao(["em_dia", "processando"])).toBe("processando");
    expect(piorSituacao([])).toBe("em_dia");
  });

  it("só avisa quando sai de 'em dia' para pendência", () => {
    expect(piorou("em_dia", "atencao")).toBe(true);
    expect(piorou("em_dia", "pendente")).toBe(true);
    expect(piorou("em_dia", "processando")).toBe(false);
    expect(piorou(undefined, "atencao")).toBe(false); // 1ª avaliação não dispara aviso
    expect(piorou("atencao", "atencao")).toBe(false);
  });
});

describe("processos do cliente", () => {
  it("os do relatório valem para todos; FGTS só com guia de FGTS recente", () => {
    expect(inferirProcessos([], hoje)).toEqual(["OMISSOES", "DEBITOS", "PARCELAMENTOS", "DIVIDA_ATIVA", "CAIXAPOSTAL"]);
    expect(inferirProcessos([doc({ createdAt: new Date(2026, 8, 1) })], hoje)).toContain("FGTS");
    expect(inferirProcessos([doc({ createdAt: new Date(2025, 0, 1) })], hoje)).not.toContain("FGTS");
  });

  it("perfil salvo em versões anteriores: PGDASD/DCTFWEB viram omissões + débitos; PROCURACAO some", () => {
    expect(normalizarProcessos(["PGDASD", "FGTS", "CAIXAPOSTAL", "PROCURACAO", "XYZ"])).toEqual(["OMISSOES", "DEBITOS", "FGTS", "CAIXAPOSTAL"]);
  });
});

describe("avaliarFgts (conforme cliente/contador marcam como pago)", () => {
  it("todas as guias pagas (ou baixa 'ok') → em dia", () => {
    const a = avaliarFgts([doc({ competence: "08/2026", dueDate: "2026-09-20", status: "paid" }), doc({ dueDate: "2026-10-20", status: "ok" })], hoje);
    expect(a).toMatchObject({ status: "em_dia", resumo: "FGTS pago (último: 09/2026)" });
  });

  it("guia em aberto ainda no prazo → pendente", () => {
    expect(avaliarFgts([doc({ dueDate: "2026-10-20" })], hoje)).toMatchObject({ status: "pendente", resumo: "FGTS de 09/2026 vence 20/10" });
  });

  it("guia vencida sem pagamento marcado → atenção (inclusive de meses anteriores)", () => {
    const a = avaliarFgts([doc({ competence: "07/2026", dueDate: "20/08/2026" }), doc({ dueDate: "2026-10-20" })], hoje);
    expect(a.status).toBe("atencao");
    expect(a.resumo).toBe("1 guia(s) do FGTS sem pagamento marcado: 07/2026");
  });

  it("vence hoje ainda não é atraso", () => {
    expect(avaliarFgts([doc({ dueDate: "2026-10-15" })], hoje).status).toBe("pendente");
    expect(avaliarFgts([doc({ dueDate: "2026-10-15" })], new Date(2026, 9, 16)).status).toBe("atencao");
  });

  it("sem guia de FGTS publicada → pendente (nunca atenção: não há o que marcar)", () => {
    expect(avaliarFgts([], new Date(2026, 9, 28)).status).toBe("pendente");
    expect(avaliarFgts([doc({ category: "INSS", dueDate: "2026-09-20" })], hoje).status).toBe("pendente");
  });
});

describe("avaliarSitfis", () => {
  const secao = (over: Partial<SitfisSecao>): SitfisSecao => ({ orgao: "RFB", tipo: "debito", titulo: "Débito (SIEF)", periodos: [], itens: [], total: 0, ...over });
  const relatorio = (secoes: SitfisSecao[], over: Partial<SitfisResultado> = {}): SitfisResultado => ({
    emitidoEm: "19/10/2026 16:06:58",
    cnpj: "11.222.333/0001-81",
    razaoSocial: "EMPRESA TESTE LTDA",
    situacaoCadastral: "ATIVA",
    secoes,
    semPendencias: secoes.length === 0,
    inconclusivo: false,
    ...over,
  });

  it("sem relatório ainda → processando (aguardando segunda)", () => {
    const r = avaliarSitfis(null);
    expect(r.OMISSOES.status).toBe("processando");
    expect(r.DIVIDA_ATIVA.resumo).toMatch(/segundas/);
  });

  it("relatório limpo → tudo em dia", () => {
    const r = avaliarSitfis(relatorio([]), "19/10/2026");
    expect(Object.values(r).every((a) => a.status === "em_dia")).toBe(true);
    expect(r.DEBITOS.resumo).toContain("19/10/2026");
  });

  it("relatório que não deu para ler → processando, pede para abrir o PDF", () => {
    const r = avaliarSitfis(relatorio([], { semPendencias: false, inconclusivo: true }));
    expect(r.OMISSOES.status).toBe("processando");
    expect(r.OMISSOES.resumo).toMatch(/PDF/);
  });

  it("classifica cada tipo de pendência", () => {
    const r = avaliarSitfis(
      relatorio([
        secao({ tipo: "omissao", titulo: "Omissão de PGDAS-D", periodos: ["AGO/2026", "SET/2026"] }),
        secao({ tipo: "debito", itens: [{ texto: "a", saldoConsolidado: 51.58 }, { texto: "b", saldoConsolidado: 1452 }], total: 1503.58 }),
        secao({ tipo: "parcelamento", titulo: "Parcelamento (PARCSN/PARCMEI)", itens: [{ texto: "p", situacao: "SIMPLES - EM PARCELAMENTO", parcelasEmAtraso: 3 }] }),
        secao({ orgao: "PGFN", tipo: "divida_ativa", titulo: "Inscrição (SIDA)", itens: [{ texto: "i", saldoConsolidado: 340.4 }], total: 340.4 }),
      ]),
    );
    expect(r.OMISSOES).toMatchObject({ status: "atencao", resumo: "Omissão: PGDAS-D (AGO/2026, SET/2026)" });
    expect(r.OMISSOES.detalhes?.declaracoes).toEqual(["PGDAS-D"]);
    expect(r.DEBITOS.status).toBe("atencao");
    expect(r.DEBITOS.resumo).toMatch(/^2 débito\(s\) na Receita — R\$\s?1\.503,58$/);
    expect(r.PARCELAMENTOS).toMatchObject({ status: "atencao", resumo: "SIMPLES - EM PARCELAMENTO: 3 parcela(s) em atraso" });
    expect(r.DIVIDA_ATIVA.status).toBe("atencao");
    expect(r.DIVIDA_ATIVA.detalhes?.total).toBe(340.4);
  });

  it("parcelamento listado sem parcela em atraso → pendente (não atenção)", () => {
    const r = avaliarSitfis(relatorio([secao({ tipo: "parcelamento", titulo: "Parcelamento (SIPADE)", itens: [{ texto: "p" }] })]));
    expect(r.PARCELAMENTOS.status).toBe("pendente");
    expect(r.DEBITOS.status).toBe("em_dia");
  });
});

describe("tipo de guia para recálculo (mesmo critério do app do cliente)", () => {
  it.each([
    [{ category: "Simples Nacional", title: "DAS Junho 2026" }, "DAS_SIMPLES"],
    [{ category: "INSS", title: "INSS 09/2026" }, "DCTFWEB_INSS"],
    [{ category: "Outros", title: "DCTFWeb 09/2026" }, "DCTFWEB_INSS"],
    [{ category: "Parcelamento", title: "Parcelamento INSS" }, null],
    [{ category: "FGTS", title: "FGTS 09/2026" }, null],
  ] as const)("%o → %s", (d, tipo) => {
    expect(tipoGuiaDoDocumento(d)).toBe(tipo);
  });
});

describe("eventos de atualização", () => {
  it("lê a matriz posicional [ni, AAMMDD|''|'x']", () => {
    const m = lerElementos([["11222333000181", "260917"], ["22333444000100", ""], ["33444555000199", "x"]]);
    expect(m.get("11222333000181")).toBe("260917");
    expect(m.get("22333444000100")).toBe("");
    expect(m.get("33444555000199")).toBe("x");
  });
});

describe("agenda (custo no Integra Contador)", () => {
  const lidos = new Set(["E0601"]);
  // 07h BRT = 10h UTC
  const em = (iso: string) => new Date(`${iso}T10:00:00Z`);

  it("relatório de situação fiscal só na segunda", () => {
    expect(diaDeSitfis(em("2026-10-19"))).toBe(true); // segunda
    expect(diaDeSitfis(em("2026-10-20"))).toBe(false);
    expect(diaDeSitfis(em("2026-10-21"), { sitfisDiasSemana: [3], caixaPostalDiasSemana: [] })).toBe(true);
  });

  it("Caixa Postal na segunda e na quinta; dia comum sem chamada", () => {
    expect(eventosDoDia(em("2026-10-19"), lidos)).toEqual(["E0601"]);
    expect(eventosDoDia(em("2026-10-22"), lidos)).toEqual(["E0601"]);
    expect(eventosDoDia(em("2026-10-21"), lidos)).toEqual([]);
  });

  it("evento nunca lido roda na hora (linha de base)", () => {
    expect(eventosDoDia(em("2026-10-21"), new Set())).toEqual(["E0601"]);
  });

  it("usa o dia de Brasília: 22h BRT de domingo ainda é domingo", () => {
    expect(eventosDoDia(new Date("2026-10-19T01:00:00Z"), lidos)).toEqual([]); // 18/10 22h BRT
    expect(diaDeSitfis(new Date("2026-10-19T01:00:00Z"))).toBe(false);
  });

  it("lista de dias configurável", () => {
    expect(lerListaNumeros("1, 4,9", 0, 6)).toEqual([1, 4]);
    expect(lerListaNumeros("", 0, 6)).toBeNull();
  });
});
