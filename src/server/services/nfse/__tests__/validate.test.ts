import { describe, it, expect } from "vitest";
import { buildDpsXml, type BuildDpsInput } from "../dps";
import { validateDps, validatePedRegEvento } from "../validate";

const base: BuildDpsInput = {
  ambiente: "homologacao",
  serie: "00001",
  numero: 3,
  competencia: "08/2026",
  dhEmi: new Date("2026-08-31T15:00:00.000Z"),
  cLocEmi: "3550308",
  prestador: { cnpj: "12345678000199", nome: "Clínica Exemplo LTDA", regimeTributario: "simples_nacional" },
  tomador: { doc: "98765432000110", nome: "Empresa Tomadora SA" },
  servico: { cTribNac: "040160", descricao: "Sessão de psicoterapia", itemListaServico: "4.16" },
  valores: { valorServicosCentavos: 25000, aliquotaIss: 2, issRetido: false, exigibilidadeIss: "1" },
};

describe("validateDps", () => {
  it("aceita uma DPS bem-formada gerada pelo builder", () => {
    expect(() => validateDps(buildDpsXml(base).xml)).not.toThrow();
  });

  it("rejeita versão fora da faixa 1.00 | 1.01", () => {
    const xml = buildDpsXml(base).xml.replace('versao="1.00"', 'versao="2.00"');
    expect(() => validateDps(xml)).toThrow(/versão do leiaute/i);
  });

  it("rejeita elemento com prefixo de namespace (E1228)", () => {
    // xmlns:ns declarado no root para o prefixo ser aceito no parse; aí a
    // checagem estrutural é quem barra.
    const xml = buildDpsXml(base)
      .xml.replace(
        'xmlns="http://www.sped.fazenda.gov.br/nfse"',
        'xmlns="http://www.sped.fazenda.gov.br/nfse" xmlns:ns="http://www.sped.fazenda.gov.br/nfse"',
      )
      .replace("<tpAmb>", "<ns:tpAmb>")
      .replace("</tpAmb>", "</ns:tpAmb>");
    expect(() => validateDps(xml)).toThrow(/namespace|prefixo/i);
  });

  it("rejeita elemento obrigatório fora de ordem", () => {
    const b = buildDpsXml(base).xml;
    // troca dhEmi e tpAmb de lugar
    const swapped = b
      .replace(/<tpAmb>(.*?)<\/tpAmb><dhEmi>(.*?)<\/dhEmi>/, "<dhEmi>$2</dhEmi><tpAmb>$1</tpAmb>");
    expect(() => validateDps(swapped)).toThrow(/fora de ordem|obrigatório/i);
  });

  it("rejeita Id de DPS fora do padrão TSIdDPS", () => {
    const xml = buildDpsXml(base).xml.replace(/Id="DPS[0-9A-Z]+"/, 'Id="DPS123"');
    expect(() => validateDps(xml)).toThrow(/Id da DPS/i);
  });

  it("exige assinatura quando requireSignature", () => {
    expect(() => validateDps(buildDpsXml(base).xml, { requireSignature: true })).toThrow(/assinatura/i);
  });

  it("rejeita encoding diferente de UTF-8", () => {
    const xml = buildDpsXml(base).xml.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"');
    expect(() => validateDps(xml)).toThrow(/UTF-8/i);
  });
});

describe("validatePedRegEvento", () => {
  const chave =
    "3550308" + "2" + "2" + "12345678000199" + "0000000000042" + "2608" + "123456789" + "5";
  const ped = `<?xml version="1.0" encoding="UTF-8"?><pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infPedReg Id="PRE${chave}101101"><tpAmb>2</tpAmb><verAplic>x</verAplic><dhEvento>2026-08-31T12:00:00-03:00</dhEvento><CNPJAutor>12345678000199</CNPJAutor><chNFSe>${chave}</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>erro na emissao teste</xMotivo></e101101></infPedReg></pedRegEvento>`;

  it("aceita um pedido de cancelamento bem-formado", () => {
    expect(() => validatePedRegEvento(ped)).not.toThrow();
  });

  it("rejeita autor fora do choice CNPJAutor|CPFAutor", () => {
    expect(() => validatePedRegEvento(ped.replace("CNPJAutor", "CNPJqualquer"))).toThrow();
  });
});
