import { describe, it, expect } from "vitest";
import { parseNfseXml } from "../nfseXml";
import { renderDanfsePdf } from "../danfseRender";

// XML da NFS-e (Sistema Nacional) reduzido ao que o emissor consome.
const NFSE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infNFSe Id="NFS35503082212345678000199000000000004226081234567895">
    <xLocEmi>São Paulo</xLocEmi>
    <xLocPrestacao>São Paulo</xLocPrestacao>
    <nNFSe>42</nNFSe>
    <xTribNac>Psicologia</xTribNac>
    <verAplic>SN-1</verAplic>
    <ambGer>2</ambGer>
    <cStat>100</cStat>
    <dhProc>2026-08-31T09:50:49-03:00</dhProc>
    <emit><CNPJ>12345678000199</CNPJ><xNome>Clínica Exemplo LTDA</xNome></emit>
    <valores>
      <pAliqAplic>2.00</pAliqAplic><vISSQN>5.00</vISSQN>
      <vTotalRet>0.00</vTotalRet><vLiq>250.00</vLiq>
    </valores>
    <DPS><infDPS Id="DPS...">
      <tpAmb>2</tpAmb>
      <dhEmi>2026-08-31T09:45:00-03:00</dhEmi>
      <serie>00001</serie><nDPS>3</nDPS><dCompet>2026-08-01</dCompet>
      <toma><CNPJ>98765432000110</CNPJ><xNome>Empresa Tomadora SA</xNome></toma>
      <serv><cServ><xDescServ>Sessão de psicoterapia</xDescServ></cServ></serv>
      <valores><vServPrest><vServ>250.00</vServ></vServPrest>
        <vDescCondIncond><vDescIncond>0.00</vDescIncond></vDescCondIncond>
      </valores>
    </infDPS></DPS>
  </infNFSe>
</NFSe>`;

describe("parseNfseXml", () => {
  const info = parseNfseXml(NFSE_XML);
  it("extrai chave, número, situação e ambiente", () => {
    expect(info.chaveAcesso).toBe("35503082212345678000199000000000004226081234567895");
    expect(info.numeroNota).toBe("42");
    expect(info.cStat).toBe("100");
    expect(info.tpAmb).toBe("2");
  });
  it("extrai competência da DPS embutida", () => {
    expect(info.competencia).toBe("08/2026");
    expect(info.serieDps).toBe("00001");
    expect(info.numeroDps).toBe("3");
  });
  it("extrai prestador, tomador e valores", () => {
    expect(info.prestadorNome).toBe("Clínica Exemplo LTDA");
    expect(info.tomadorDoc).toBe("98765432000110");
    expect(info.valorServico).toBe("250.00");
    expect(info.valorLiquido).toBe("250.00");
    expect(info.aliquota).toBe("2.00");
  });
  it("XML vazio não quebra", () => {
    expect(parseNfseXml("").chaveAcesso).toBeNull();
  });
});

describe("renderDanfsePdf", () => {
  it("gera um PDF a partir do XML da NFS-e", async () => {
    const pdf = await renderDanfsePdf(NFSE_XML);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
  it("aplica a marca d'água de cancelamento sem erro", async () => {
    const pdf = await renderDanfsePdf(NFSE_XML, { cancelada: true });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
