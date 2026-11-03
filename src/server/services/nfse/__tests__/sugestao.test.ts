import { describe, it, expect, vi } from "vitest";

vi.mock("../../../db", () => ({ db: {}, pool: {} }));
const { sugestoesDasNotas, sugestoesDoCnae, itemDoCodigo } = await import("../sugestao");
const { CNAE_SERVICO, DESCRICAO_TRIB_NAC } = await import("../cnaeServico");

const nota = (c: string, extra = "") =>
  `<NFSe><infNFSe><xTribNac>Ginástica, dança, esportes</xTribNac><DPS><infDPS><serv><cServ><cTribNac>${c}</cTribNac>${extra}</cServ></serv></infDPS></DPS></infNFSe></NFSe>`;

describe("sugestões pelas notas anteriores", () => {
  it("agrupa por código, do mais usado ao menos usado, com descrição, código municipal e NBS mais frequentes", () => {
    const xmls = [
      nota("060401", "<cTribMun>408</cTribMun><xDescServ>Mensalidade da academia</xDescServ><cNBS>122051200</cNBS>"),
      nota("060401", "<xDescServ>Mensalidade da academia</xDescServ>"),
      nota("060401", "<xDescServ>Plano trimestral &amp; avaliação</xDescServ>"),
      nota("080201", "<xDescServ>Aula avulsa</xDescServ>"),
    ];
    const s = sugestoesDasNotas(xmls);
    expect(s.map((x) => x.cTribNac)).toEqual(["060401", "080201"]);
    expect(s[0]).toMatchObject({ origem: "notas", notas: 3, cTribMun: "408", cNbs: "122051200", descricao: "Mensalidade da academia", nome: "Ginástica, dança, esportes" });
  });
  it("sem cTribNac válido não sugere nada", () => {
    expect(sugestoesDasNotas(["<NFSe/>", nota("12")])).toEqual([]);
  });
});

describe("sugestões pelo CNAE", () => {
  it("serviço vira código oficial; comércio fica de fora; principal primeiro; sem repetir código", () => {
    const s = sugestoesDoCnae(["8650004", "4712100", "8650004", "9313100"]);
    expect(s.map((x) => x.cTribNac)).toEqual(["040802", "060401"]);
    expect(s[0]).toMatchObject({ origem: "cnae", cnae: "8650004", nome: "Fisioterapia.", conferir: null, descricao: "" });
  });
  it("CNAE com zero à esquerda perdido (6 dígitos) também casa", () => {
    expect(sugestoesDoCnae(["155505"])).toEqual([]); // produção de ovos: sem ISS
  });
  it("correspondência que pede atenção vem com o motivo", () => {
    expect(sugestoesDoCnae(["4321500"])[0].conferir).toMatch(/empreitada/);
  });
  it("todo código da tabela tem a descrição oficial", () => {
    for (const { cTribNac } of Object.values(CNAE_SERVICO)) expect(DESCRICAO_TRIB_NAC[cTribNac]).toBeTruthy();
  });
  it("item da LC 116 a partir do código", () => {
    expect(itemDoCodigo("040802")).toBe("4.08");
    expect(itemDoCodigo("171901")).toBe("17.19");
  });
});
