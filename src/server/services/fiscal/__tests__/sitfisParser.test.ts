import { describe, it, expect } from "vitest";
import { lerSitfis, montarLinhas, classificarSecao } from "../sitfisParser";

// Relatório FICTÍCIO no formato das linhas que extrairLinhasPdf() devolve de
// um SITFIS real (página em paisagem, colunas separadas por " | "). Inclui a
// sub-tabela da PGFN desenhada fora do lugar, como no PDF da Receita.
const RELATORIO = `MINISTÉRIO DA FAZENDA  |  Por meio do Portal de Serviços da Receita Federal
SECRETARIA ESPECIAL DA RECEITA FEDERAL DO BRASIL  |  CNPJ do certificado: 11.222.333/0001-81
PROCURADORIA-GERAL DA FAZENDA NACIONAL  |  19/10/2026 16:06:58
INFORMAÇÕES DE APOIO PARA EMISSÃO DE CERTIDÃO
Página: 1 / 2
CNPJ: 11.222.333 - EMPRESA TESTE LTDA
Dados Cadastrais  |  da Matriz ______________________________________________
CNPJ: 11.222.333/0001-81
Situação: ATIVA
_____________________ Diagnóstico Fiscal na Receita Federal  |  _____________________
Omissão de  |  PGDAS-D ______________________________________________________
(Período de Apuração)  |  2026 - AGO, SET
Pendência  |  - Parcelamento (PARCSN/PARCMEI) _______________________________
CNPJ: 11.222.333/0001-81
SIMPLES - EM PARCELAMENTO  |  Parcelas em atraso
3
Pendência  |  - Débito (SIEF) _______________________________________________
CNPJ: 11.222.333/0001-81
Receita  |  PA/Exerc. Dt. Vcto  |  Vl. Original  |  Sdo. Devedor  |  Multa  |  Juros Sdo. Dev. Cons.
4406-01 - MAED - PGDAS-D 21/06/2024 20/07/2026  |  50,00  |  50,00  |  0,00  |  1,58  |  51,58
Situação: EM PROCESSO DE ENVIO A PFN
Notificação de lançamento: 11222333202405001
1082-01 - CP SEGURADOS 08/2026 20/09/2026  |  1.200,00  |  1.200,00  |  240,00  |  12,00  |  1.452,00
Situação: DEVEDOR
Notificação de lançamento: 11222333202608001
MINISTÉRIO DA FAZENDA  |  Por meio do Portal de Serviços da Receita Federal
Página: 2 / 2
CNPJ: 11.222.333 - EMPRESA TESTE LTDA
Receita  |  PA/Exerc. Dt. Vcto  |  Vl. Original  |  Sdo. Devedor  |  Multa  |  Juros Sdo. Dev. Cons. Situação
SIMPLES NAC.  |  07/2026  |  20/08/2026  |  279,30  |  279,30  |  55,30  |  5,80  |  340,40 DEVEDOR
__________________________ Diagnóstico Fiscal na Procuradoria-Geral da  |  Fazenda  |  Nacional  |  ___________
Pendência  |  - Inscrição (SIDA) ____________________________________________
CNPJ: 11.222.333/0001-81
Inscrição  |  Receita  |  Inscrito em  |  Ajuizado em  |  Processo  |  Tipo de Devedor
50.6.26.000001-10  |  4834-- MULTA  |  19/10/2026  |  19321.000.001/2026-80  |  DEVEDOR PRINCIPAL
ISOLADA
Situação: ATIVA A SER COBRADA
____________________________________________________________________________
Final do Relatório`.split("\n");

describe("lerSitfis", () => {
  const r = lerSitfis(RELATORIO);
  const secao = (tipo: string) => r.secoes.find((s) => s.tipo === tipo)!;

  it("lê os dados do cabeçalho", () => {
    expect(r.emitidoEm).toBe("19/10/2026 16:06:58");
    expect(r.cnpj).toBe("11.222.333/0001-81");
    expect(r.razaoSocial).toBe("EMPRESA TESTE LTDA");
    expect(r.situacaoCadastral).toBe("ATIVA");
    expect(r.semPendencias).toBe(false);
    expect(r.inconclusivo).toBe(false);
  });

  it("omissão de declaração com os períodos", () => {
    const o = secao("omissao");
    expect(o.titulo).toBe("Omissão de PGDAS-D");
    expect(o.periodos).toEqual(["AGO/2026", "SET/2026"]);
  });

  it("parcelamento com parcelas em atraso", () => {
    expect(secao("parcelamento").itens[0]).toMatchObject({ situacao: "SIMPLES - EM PARCELAMENTO", parcelasEmAtraso: 3 });
  });

  it("débitos da Receita: valores, situação e notificação de cada item", () => {
    const d = secao("debito");
    expect(d.orgao).toBe("RFB");
    expect(d.itens).toHaveLength(2);
    expect(d.itens[0]).toMatchObject({
      codigoReceita: "4406-01",
      pa: "21/06/2024",
      vencimento: "20/07/2026",
      saldoConsolidado: 51.58,
      situacao: "EM PROCESSO DE ENVIO A PFN",
      referencia: "11222333202405001",
    });
    expect(d.itens[1]).toMatchObject({ pa: "08/2026", multa: 240, saldoConsolidado: 1452, referencia: "11222333202608001" });
    expect(d.total).toBe(1503.58);
  });

  it("dívida ativa: liga a sub-tabela desenhada fora do lugar à inscrição", () => {
    const pgfn = secao("divida_ativa");
    expect(pgfn.orgao).toBe("PGFN");
    expect(pgfn.itens).toHaveLength(1);
    expect(pgfn.itens[0]).toMatchObject({
      referencia: "50.6.26.000001-10",
      receita: "4834-- MULTA ISOLADA SIMPLES NAC.",
      pa: "07/2026",
      saldoConsolidado: 340.4,
      situacao: "ATIVA A SER COBRADA",
    });
    // e o valor dela não vazou para os débitos da Receita
    expect(secao("debito").itens.some((i) => i.saldoConsolidado === 340.4)).toBe(false);
  });

  it("relatório sem pendências", () => {
    const limpo = lerSitfis([
      "CNPJ: 11.222.333/0001-81",
      "Diagnóstico Fiscal na Receita Federal e na Procuradoria-Geral da Fazenda Nacional",
      "Não foram detectadas pendências/exigibilidades suspensas nos controles da Receita Federal e da Procuradoria-Geral da Fazenda Nacional.",
    ]);
    expect(limpo.semPendencias).toBe(true);
    expect(limpo.secoes).toHaveLength(0);
    expect(limpo.inconclusivo).toBe(false);
  });

  it("sem seções nem a frase de regularidade → inconclusivo (abre o PDF)", () => {
    expect(lerSitfis(["texto qualquer", "sem nada reconhecível"]).inconclusivo).toBe(true);
  });
});

describe("montarLinhas", () => {
  it("monta as linhas de uma página girada 90° (paisagem)", () => {
    // matriz [0, s, -s, 0, e, f]: a linha é o eixo e; a posição na linha é f
    const itens = [
      { str: "Receita", transform: [0, 9, -9, 0, 146, 12] },
      { str: "PA/Exerc.", transform: [0, 9, -9, 0, 146, 161] },
      { str: "4406-01 - MAED", transform: [0, 9, -9, 0, 159, 12] },
      { str: "50,00", transform: [0, 9, -9, 0, 159, 351] },
    ];
    expect(montarLinhas(itens)).toEqual(["Receita  |  PA/Exerc.", "4406-01 - MAED  |  50,00"]);
  });
});

describe("classificarSecao", () => {
  it.each([
    ["Omissão de DCTFWeb", "RFB", "omissao"],
    ["Parcelamento (SIPADE)", "RFB", "parcelamento"],
    ["Débito (SIEF)", "RFB", "debito"],
    ["Processo Fiscal (SIEF)", "RFB", "processo"],
    ["Inscrição (SIDA)", "PGFN", "divida_ativa"],
  ] as const)("%s → %s", (titulo, orgao, tipo) => {
    expect(classificarSecao(titulo, orgao)).toBe(tipo);
  });
});
