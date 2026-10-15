import { describe, it, expect } from "vitest";
import {
  avaliarParcelamento,
  avaliarPorGuias,
  competenciaAnterior,
  dctfwebTransmitidaPeloEvento,
  inferirProcessos,
  lerElementos,
  piorSituacao,
  eventosDoDia,
  lerListaNumeros,
  type DocGuia,
} from "../regras";

const hoje = new Date(2026, 9, 15); // 15/10/2026 → competência 09/2026
const doc = (over: Partial<DocGuia>): DocGuia => ({ category: "Simples Nacional", competence: "09/2026", status: "new", ...over });

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
});

describe("avaliarPorGuias (sem SERPRO)", () => {
  it("guia paga → em dia", () => {
    expect(avaliarPorGuias("PGDASD", [doc({ status: "paid" })], "09/2026", hoje).status).toBe("em_dia");
  });

  it("guia publicada ainda no prazo → pendente", () => {
    const a = avaliarPorGuias("PGDASD", [doc({ dueDate: "2026-10-20" })], "09/2026", hoje);
    expect(a.status).toBe("pendente");
    expect(a.semGuia).toBe(false);
  });

  it("guia vencida e não paga → atenção", () => {
    const a = avaliarPorGuias("PGDASD", [doc({ dueDate: "20/10/2026" })], "09/2026", new Date(2026, 9, 21));
    expect(a.status).toBe("atencao");
  });

  it("sem guia antes do prazo → pendente; depois do prazo → atenção (e semGuia)", () => {
    expect(avaliarPorGuias("DCTFWEB", [], "09/2026", hoje).status).toBe("pendente");
    const depois = avaliarPorGuias("DCTFWEB", [], "09/2026", new Date(2026, 9, 16));
    expect(depois.status).toBe("atencao");
    expect(depois.semGuia).toBe(true);
  });

  it("só conta a categoria do processo", () => {
    const a = avaliarPorGuias("FGTS", [doc({ category: "INSS", status: "paid" })], "09/2026", hoje);
    expect(a.semGuia).toBe(true);
  });
});

describe("inferirProcessos", () => {
  it("deduz os processos pelas guias publicadas", () => {
    const docs = [doc({}), doc({ category: "INSS" }), doc({ category: "FGTS" })];
    expect(inferirProcessos(docs, hoje, false)).toEqual(["PGDASD", "DCTFWEB", "FGTS", "CAIXAPOSTAL", "PROCURACAO"]);
  });

  it("parcelamento cadastrado inclui o processo mesmo sem guia", () => {
    expect(inferirProcessos([], hoje, true)).toContain("PARCELAMENTOS");
  });

  it("ignora guias com mais de 6 meses", () => {
    expect(inferirProcessos([doc({ createdAt: new Date(2025, 0, 1) })], hoje, false)).not.toContain("PGDASD");
  });
});

describe("eventos de atualização", () => {
  it("lê a matriz posicional [ni, AAMMDD|''|'x']", () => {
    const m = lerElementos([["11222333000181", "260917"], ["22333444000100", ""], ["33444555000199", "x"]]);
    expect(m.get("11222333000181")).toBe("260917");
    expect(m.get("22333444000100")).toBe("");
    expect(m.get("33444555000199")).toBe("x");
  });

  it("DCTFWeb: transmissão depois do fim da competência conta", () => {
    expect(dctfwebTransmitidaPeloEvento("261012", "09/2026")).toBe(true);
    expect(dctfwebTransmitidaPeloEvento("260915", "09/2026")).toBe(false);
    // "sem atualização" não diz desde quando: desconhecido, não "não transmitida"
    expect(dctfwebTransmitidaPeloEvento("", "09/2026")).toBeNull();
    expect(dctfwebTransmitidaPeloEvento("x", "09/2026")).toBeNull();
    expect(dctfwebTransmitidaPeloEvento(undefined, "09/2026")).toBeNull();
  });
});

describe("avaliarParcelamento", () => {
  const p = { modalidade: "PARCSN", numero: "123", origem: "serpro", ativo: true };

  it("parcela do mês anterior paga → em dia", () => {
    expect(avaliarParcelamento({ ...p, ultimoPagamento: "09/2026" }, [], hoje).status).toBe("em_dia");
  });

  it("parcela atrasada → atenção", () => {
    expect(avaliarParcelamento({ ...p, ultimoPagamento: "07/2026" }, [], hoje).status).toBe("atencao");
  });

  it("manual usa as guias de parcelamento pagas", () => {
    const docs = [doc({ category: "Parcelamento", competence: "09/2026", status: "paid" })];
    expect(avaliarParcelamento({ ...p, origem: "manual", modalidade: "INSS" }, docs, hoje).status).toBe("em_dia");
  });

  it("rescindido não gera pendência", () => {
    expect(avaliarParcelamento({ ...p, situacao: "Rescindido" }, [], hoje).status).toBe("em_dia");
  });
});

describe("agenda dos eventos (custo no Integra Contador)", () => {
  const lidos = new Set(["E0301", "E0601"]);
  // 07h BRT = 10h UTC
  const em = (iso: string) => new Date(`${iso}T10:00:00Z`);

  it("segunda: só Caixa Postal", () => {
    expect(eventosDoDia(em("2026-10-19"), lidos)).toEqual(["E0601"]);
  });

  it("quinta (dia 15): só Caixa Postal; sexta dia 16: só DCTFWeb", () => {
    expect(eventosDoDia(em("2026-10-15"), lidos)).toEqual(["E0601"]); // quinta, dia 15
    expect(eventosDoDia(em("2026-10-16"), lidos)).toEqual(["E0301"]); // sexta, dia 16
  });

  it("dia comum: nenhum evento — zero chamadas", () => {
    expect(eventosDoDia(em("2026-10-21"), lidos)).toEqual([]); // quarta
  });

  it("evento nunca lido roda na hora (linha de base)", () => {
    expect(eventosDoDia(em("2026-10-21"), new Set())).toEqual(["E0301", "E0601"]);
  });

  it("usa o dia de Brasília: 22h BRT de domingo ainda é domingo", () => {
    expect(eventosDoDia(new Date("2026-10-19T01:00:00Z"), lidos)).toEqual([]); // 18/10 22h BRT
  });

  it("agenda configurável", () => {
    expect(eventosDoDia(em("2026-10-21"), lidos, { caixaPostalDiasSemana: [3], dctfwebDiasMes: [21] })).toEqual(["E0301", "E0601"]);
    expect(lerListaNumeros("1, 4,9", 0, 6)).toEqual([1, 4]);
    expect(lerListaNumeros("", 0, 6)).toBeNull();
  });
});
