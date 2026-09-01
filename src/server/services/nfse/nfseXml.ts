import { DOMParser } from "@xmldom/xmldom";
import { normalizeInscricao } from "./inscricao";

// Leitura do XML da NFS-e devolvido pelo Sefin Nacional. Extrai o que
// persistimos / exibimos e o que o DANFSe precisa. Tolerante: campos ausentes
// viram null.

export interface NfseXmlInfo {
  chaveAcesso: string | null; // do atributo Id de infNFSe, sem o literal "NFS"
  numeroNota: string | null; // nNFSe
  cStat: string | null; // 100 = NFS-e Gerada
  dhProc: string | null; // data/hora de processamento
  dhEmiDps: string | null; // dhEmi da DPS
  ambienteGerador: string | null; // ambGer
  tpAmb: string | null; // 1 = Produção, 2 = Homologação
  competencia: string | null; // dCompet da DPS embutida (MM/YYYY)
  serieDps: string | null;
  numeroDps: string | null;
  xLocEmi: string | null; // descrição do município emissor
  xLocPrestacao: string | null; // descrição do município da prestação
  xTribNac: string | null; // descrição do código de tributação nacional
  descServico: string | null; // xDescServ
  prestadorNome: string | null;
  prestadorDoc: string | null;
  tomadorNome: string | null;
  tomadorDoc: string | null;
  valorServico: string | null; // vServ
  valorLiquido: string | null; // vLiq
  valorIssqn: string | null; // vISSQN
  valorDescIncond: string | null; // vDescIncond
  valorTotalRet: string | null; // vTotalRet
  aliquota: string | null; // pAliqAplic
}

function txt(root: any, tag: string): string | null {
  const els = root.getElementsByTagName(tag);
  const v = els && els[0] ? String(els[0].textContent ?? "").trim() : "";
  return v || null;
}

function firstAttr(root: any, tag: string, attr: string): string | null {
  const els = root.getElementsByTagName(tag);
  const v = els && els[0] ? String(els[0].getAttribute(attr) ?? "").trim() : "";
  return v || null;
}

export function parseNfseXml(xml: string): NfseXmlInfo {
  const empty: NfseXmlInfo = {
    chaveAcesso: null,
    numeroNota: null,
    cStat: null,
    dhProc: null,
    dhEmiDps: null,
    ambienteGerador: null,
    tpAmb: null,
    competencia: null,
    serieDps: null,
    numeroDps: null,
    xLocEmi: null,
    xLocPrestacao: null,
    xTribNac: null,
    descServico: null,
    prestadorNome: null,
    prestadorDoc: null,
    tomadorNome: null,
    tomadorDoc: null,
    valorServico: null,
    valorLiquido: null,
    valorIssqn: null,
    valorDescIncond: null,
    valorTotalRet: null,
    aliquota: null,
  };
  if (!xml || !xml.includes("<")) return empty;

  let doc: any;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml");
  } catch {
    return empty;
  }
  const root = doc?.documentElement;
  if (!root) return empty;

  const idNfse = (firstAttr(root, "infNFSe", "Id") || "").replace(/^NFS/i, "");
  const dCompet = txt(root, "dCompet");
  const comp = dCompet && /^\d{4}-\d{2}-\d{2}$/.test(dCompet)
    ? `${dCompet.slice(5, 7)}/${dCompet.slice(0, 4)}`
    : null;

  const emitEls = root.getElementsByTagName("emit");
  const emit = emitEls && emitEls[0];
  const tomaEls = root.getElementsByTagName("toma");
  const toma = tomaEls && tomaEls[0];

  const pick = (el: any, tag: string) => {
    if (!el) return null;
    const c = el.getElementsByTagName(tag);
    const v = c && c[0] ? String(c[0].textContent ?? "").trim() : "";
    return v || null;
  };

  return {
    chaveAcesso: normalizeInscricao(idNfse) || null,
    numeroNota: txt(root, "nNFSe"),
    cStat: txt(root, "cStat"),
    dhProc: txt(root, "dhProc"),
    dhEmiDps: txt(root, "dhEmi"),
    ambienteGerador: txt(root, "ambGer"),
    tpAmb: txt(root, "tpAmb"),
    competencia: comp,
    serieDps: txt(root, "serie"),
    numeroDps: txt(root, "nDPS"),
    xLocEmi: txt(root, "xLocEmi"),
    xLocPrestacao: txt(root, "xLocPrestacao"),
    xTribNac: txt(root, "xTribNac"),
    descServico: txt(root, "xDescServ"),
    prestadorNome: pick(emit, "xNome"),
    prestadorDoc: pick(emit, "CNPJ") || pick(emit, "CPF"),
    tomadorNome: pick(toma, "xNome"),
    tomadorDoc: pick(toma, "CNPJ") || pick(toma, "CPF"),
    valorServico: txt(root, "vServ"),
    valorLiquido: txt(root, "vLiq"),
    valorIssqn: txt(root, "vISSQN"),
    valorDescIncond: txt(root, "vDescIncond"),
    valorTotalRet: txt(root, "vTotalRet"),
    aliquota: txt(root, "pAliqAplic"),
  };
}
