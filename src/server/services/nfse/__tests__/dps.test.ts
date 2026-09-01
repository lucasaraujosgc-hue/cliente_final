import { describe, it, expect } from "vitest";
import { buildDpsXml, buildDpsId, type BuildDpsInput } from "../dps";
import { parseChaveAcesso } from "../chave";

const base: BuildDpsInput = {
  ambiente: "homologacao",
  serie: "00001",
  numero: 7,
  competencia: "08/2026",
  dhEmi: new Date("2026-08-31T15:00:00.000Z"),
  cLocEmi: "3550308",
  prestador: {
    cnpj: "12345678000199",
    nome: "Clínica Exemplo LTDA",
    regimeTributario: "simples_nacional",
  },
  tomador: {
    doc: "98765432000110",
    nome: "Empresa Tomadora SA",
    email: "financeiro@tomadora.com",
    telefone: "1133224455",
    endereco: {
      logradouro: "Av. Paulista",
      numero: "1000",
      bairro: "Bela Vista",
      codigoMunicipio: "3550308",
      cep: "01310100",
    },
  },
  servico: { cTribNac: "040160", descricao: "Sessão de psicoterapia", itemListaServico: "4.16" },
  valores: {
    valorServicosCentavos: 25000,
    aliquotaIss: 2,
    issRetido: false,
    exigibilidadeIss: "1",
  },
};

describe("buildDpsId", () => {
  it("produces DPS + 42 digits", () => {
    const id = buildDpsId("3550308", "12345678000199", "00001", 7);
    expect(id).toMatch(/^DPS\d{42}$/);
    // 7 (mun) + 1 (tpInsc=2) + 14 (CNPJ) + 5 (serie) + 15 (num)
    expect(id.slice(3, 10)).toBe("3550308");
    expect(id.slice(10, 11)).toBe("2");
    expect(id.slice(11, 25)).toBe("12345678000199");
    expect(id.slice(25, 30)).toBe("00001");
    expect(id.slice(30)).toBe("000000000000007");
  });
});

describe("buildDpsXml", () => {
  const built = buildDpsXml(base);

  it("has the DPS root with the national namespace and versao", () => {
    expect(built.xml).toContain('xmlns="http://www.sped.fazenda.gov.br/nfse"');
    expect(built.xml).toContain('versao="1.00"');
    expect(built.xml).toContain(`<infDPS Id="${built.idDps}">`);
  });

  it("emits infDPS children in schema order", () => {
    const order = ["tpAmb", "dhEmi", "verAplic", "serie", "nDPS", "dCompet", "tpEmit", "cLocEmi", "prest", "toma", "serv", "valores"];
    const positions = order.map((t) => built.xml.indexOf(`<${t}>`));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it("uses homologação ambiente and unpadded nDPS", () => {
    expect(built.xml).toContain("<tpAmb>2</tpAmb>");
    expect(built.xml).toContain("<nDPS>7</nDPS>");
    expect(built.xml).toContain("<serie>00001</serie>");
    expect(built.xml).toContain("<dCompet>2026-08-01</dCompet>");
  });

  it("formats money with two decimals from centavos", () => {
    expect(built.xml).toContain("<vServ>250.00</vServ>");
  });

  it("maps Simples Nacional to opSimpNac 3 and ISS não retido", () => {
    expect(built.xml).toContain("<opSimpNac>3</opSimpNac>");
    expect(built.xml).toContain("<tpRetISSQN>1</tpRetISSQN>");
    expect(built.xml).toContain("<pAliq>2.00</pAliq>");
  });

  it("includes the tomador with a full national address", () => {
    expect(built.xml).toContain("<CNPJ>98765432000110</CNPJ>");
    expect(built.xml).toContain("<xNome>Empresa Tomadora SA</xNome>");
    expect(built.xml).toContain("<cMun>3550308</cMun>");
    expect(built.xml).toContain("<CEP>01310100</CEP>");
    expect(built.xml).toContain("<xLgr>Av. Paulista</xLgr>");
  });

  it("omits the tomador address block when incomplete", () => {
    const noAddr = buildDpsXml({
      ...base,
      tomador: { doc: "98765432000110", nome: "Sem Endereço SA" },
    });
    expect(noAddr.xml).not.toContain("<endNac>");
    expect(noAddr.xml).toContain("<xNome>Sem Endereço SA</xNome>");
  });

  it("adds tribFed only when there is federal retention", () => {
    expect(built.xml).not.toContain("<tribFed>");
    const withRet = buildDpsXml({
      ...base,
      valores: { ...base.valores, retIrrf: 1.5, retInss: 11 },
    });
    expect(withRet.xml).toContain("<tribFed>");
    expect(withRet.xml).toContain("<vRetIRRF>3.75</vRetIRRF>"); // 250 * 1.5%
    expect(withRet.xml).toContain("<vRetCP>27.50</vRetCP>"); // 250 * 11%
  });

  it("derives cTribNac from the LC116 item when not provided", () => {
    const derived = buildDpsXml({
      ...base,
      servico: { descricao: "x", itemListaServico: "4.16" },
    });
    expect(derived.xml).toContain("<cTribNac>041600</cTribNac>");
  });

  it("rejects a missing município IBGE", () => {
    expect(() => buildDpsXml({ ...base, cLocEmi: "" })).toThrow(/IBGE/i);
  });
});

describe("CNPJ alfanumérico (NT-009)", () => {
  it("preserva letras no Id e no elemento CNPJ do prestador", () => {
    const built = buildDpsXml({
      ...base,
      prestador: { ...base.prestador, cnpj: "12ABC678000D99" },
    });
    expect(built.idDps.slice(10, 11)).toBe("2");
    expect(built.idDps.slice(11, 25)).toBe("12ABC678000D99");
    expect(built.xml).toContain("<CNPJ>12ABC678000D99</CNPJ>");
  });

  it("aceita tomador com CNPJ alfanumérico", () => {
    const built = buildDpsXml({
      ...base,
      tomador: { doc: "98XYZ432000A10", nome: "Tomador Alfa SA" },
    });
    expect(built.xml).toContain("<CNPJ>98XYZ432000A10</CNPJ>");
  });
});

describe("códigos pré-configurados pelo contador", () => {
  it("emite cNBS, tribISSQN configurável e regApTribSN (SN ME/EPP)", () => {
    const built = buildDpsXml({
      ...base,
      prestador: { ...base.prestador, regimeTributario: "simples_nacional", regApTribSN: "2" },
      servico: { ...base.servico, cNBS: "123456789" },
      valores: { ...base.valores, tribISSQN: "1" },
    });
    expect(built.xml).toContain("<cNBS>123456789</cNBS>");
    expect(built.xml).toContain("<opSimpNac>3</opSimpNac><regApTribSN>2</regApTribSN><regEspTrib>");
  });

  it("não emite regApTribSN fora do Simples ME/EPP", () => {
    const built = buildDpsXml({
      ...base,
      prestador: { ...base.prestador, regimeTributario: "mei", regApTribSN: "2" },
    });
    expect(built.xml).not.toContain("<regApTribSN>");
  });

  it("tribISSQN 3 (exportação) omite pAliq", () => {
    const built = buildDpsXml({ ...base, valores: { ...base.valores, tribISSQN: "3", aliquotaIss: 5 } });
    expect(built.xml).toContain("<tribISSQN>3</tribISSQN>");
    expect(built.xml).not.toContain("<pAliq>");
  });

  it("emite o bloco piscofins quando há CST", () => {
    const built = buildDpsXml({
      ...base,
      valores: { ...base.valores, pisCofinsCST: "01", aliqPis: 1.65, aliqCofins: 7.6 },
    });
    expect(built.xml).toContain("<piscofins><CST>01</CST>");
    expect(built.xml).toContain("<pAliqPis>1.65</pAliqPis>");
    expect(built.xml).toContain("<vCofins>19.00</vCofins>"); // 250 * 7.6%
  });

  it("não emite piscofins sem CST", () => {
    expect(buildDpsXml(base).xml).not.toContain("<piscofins>");
  });

  it("IBSCBS não é emitido por padrão (NFSE_IBSCBS_ENVIAR off)", () => {
    const built = buildDpsXml({
      ...base,
      ibsCbs: { cst: "000", cClassTrib: "000001", cIndOp: "100000", indDest: "0" },
    });
    expect(built.xml).not.toContain("<IBSCBS>");
  });
});

describe("saneamento de texto (ISO-8859-1)", () => {
  it("transliteria travessão, aspas curvas e reticências na descrição", () => {
    const built = buildDpsXml({
      ...base,
      servico: { ...base.servico, descricao: "Consultoria — “premium” … 1º nível" },
    });
    const d = built.xml.match(/<xDescServ>(.*?)<\/xDescServ>/)?.[1] ?? "";
    expect(d).toBe('Consultoria - "premium" ... 1º nível');
    expect(d).not.toMatch(/[—“…]/);
  });

  it("remove caractere fora do Latin-1 no nome do tomador", () => {
    const built = buildDpsXml({
      ...base,
      tomador: { doc: "98765432000110", nome: "Empresa 😀 Ação Ltda" },
    });
    expect(built.xml).toContain("<xNome>Empresa Ação Ltda</xNome>");
  });
});

describe("regras de tamanho", () => {
  it("trunca xDescServ em 1000 caracteres (Anexo I)", () => {
    const built = buildDpsXml({ ...base, servico: { ...base.servico, descricao: "x".repeat(1500) } });
    const m = built.xml.match(/<xDescServ>(x+)<\/xDescServ>/);
    expect(m?.[1].length).toBe(1000);
  });

  it("rejeita número de DPS < 1", () => {
    expect(() => buildDpsXml({ ...base, numero: 0 })).toThrow(/Número da DPS/i);
  });
});

describe("parseChaveAcesso", () => {
  it("returns null for non-50-digit input", () => {
    expect(parseChaveAcesso("123")).toBeNull();
    expect(parseChaveAcesso("")).toBeNull();
  });

  it("pulls the município, número and competência from a 50-digit key", () => {
    // mun(7) amb(1) tpInsc(1) inscFed(14) nNFSe(13) AAMM(4) cNum(9) dv(1)
    const chave =
      "3550308" + "2" + "2" + "12345678000199" + "0000000000042" + "2608" + "123456789" + "5";
    expect(chave).toHaveLength(50);
    const info = parseChaveAcesso(chave)!;
    expect(info.codigoMunicipio).toBe("3550308");
    expect(info.numero).toBe("42");
    expect(info.competencia).toBe("08/2026");
    expect(info.dv).toBe("5");
  });
});
