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

// --- Leitura completa para o DANFSe ---------------------------------------------
// Separa o que é da NFS-e (infNFSe: emitente, valores apurados pela Sefin) do
// que veio na DPS (prestador, tomador, serviço, tributação declarada).

export interface EnderecoDanfse {
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cMun: string | null;
  uf: string | null;
  cep: string | null;
}

export interface PessoaDanfse {
  doc: string | null; // CNPJ / CPF
  im: string | null;
  nome: string | null;
  fone: string | null;
  email: string | null;
  end: EnderecoDanfse;
}

export interface NfseDanfse {
  chaveAcesso: string | null;
  nNFSe: string | null;
  cStat: string | null;
  dhProc: string | null;
  tpAmb: string | null;
  ambGer: string | null;
  xLocEmi: string | null;
  xLocPrestacao: string | null;
  xLocIncid: string | null;
  xTribNac: string | null;
  xTribMun: string | null;
  xNBS: string | null;
  xOutInf: string | null;
  emit: PessoaDanfse;
  toma: PessoaDanfse | null;
  dps: {
    nDPS: string | null;
    serie: string | null;
    dhEmi: string | null;
    dCompet: string | null; // AAAA-MM-DD
    opSimpNac: string | null;
    regApTribSN: string | null;
    cTribNac: string | null;
    cTribMun: string | null;
    cNBS: string | null;
    xDescServ: string | null;
    xInfComp: string | null;
    tribISSQN: string | null;
    tpRetISSQN: string | null;
    pAliq: string | null;
    pTotTribSN: string | null;
    vServ: string | null;
    vDescIncond: string | null;
    vDescCond: string | null;
    obra: { cObra: string | null; end: EnderecoDanfse | null } | null;
    evento: { xNome: string | null; dtIni: string | null; dtFim: string | null; idAtvEvt: string | null; end: EnderecoDanfse | null } | null;
  };
  valores: {
    vBC: string | null;
    pAliqAplic: string | null;
    vISSQN: string | null;
    vTotalRet: string | null;
    vLiq: string | null;
  };
}

const filhos = (el: any): any[] => {
  const out: any[] = [];
  for (let c = el?.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c);
  return out;
};
const nomeLocal = (el: any) => el.localName || String(el.nodeName || "").replace(/^.*:/, "");
/** Primeiro filho direto com o nome. */
const filho = (el: any, nome: string) => (el ? filhos(el).find((c) => nomeLocal(c) === nome) ?? null : null);
/** Primeiro descendente com o nome, só dentro de `el`. */
const desc = (el: any, nome: string) => {
  if (!el) return null;
  const l = el.getElementsByTagName(nome);
  return l && l[0] ? l[0] : null;
};
const tx = (el: any) => {
  const v = el ? String(el.textContent ?? "").trim() : "";
  return v || null;
};

function enderecoDe(end: any): EnderecoDanfse | null {
  if (!end) return null;
  const nac = filho(end, "endNac");
  return {
    logradouro: tx(filho(end, "xLgr")),
    numero: tx(filho(end, "nro")),
    complemento: tx(filho(end, "xCpl")),
    bairro: tx(filho(end, "xBairro")),
    cMun: tx(filho(nac, "cMun")),
    uf: tx(filho(nac, "UF")) || tx(filho(end, "UF")),
    cep: tx(filho(nac, "CEP")) || tx(filho(end, "CEP")),
  };
}

const ENDERECO_VAZIO: EnderecoDanfse = { logradouro: null, numero: null, complemento: null, bairro: null, cMun: null, uf: null, cep: null };

function pessoaDe(el: any, endTag: string): PessoaDanfse {
  return {
    doc: tx(filho(el, "CNPJ")) || tx(filho(el, "CPF")) || tx(filho(el, "NIF")),
    im: tx(filho(el, "IM")),
    nome: tx(filho(el, "xNome")),
    fone: tx(filho(el, "fone")),
    email: tx(filho(el, "email")),
    end: enderecoDe(filho(el, endTag)) ?? ENDERECO_VAZIO,
  };
}

export function lerNfseDanfse(xml: string): NfseDanfse {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const inf = desc(doc?.documentElement, "infNFSe");
  if (!inf) throw new Error("XML sem infNFSe");
  const infDps = desc(filho(inf, "DPS"), "infDPS");
  const prest = filho(infDps, "prest");
  const tomaEl = filho(infDps, "toma");
  const serv = filho(infDps, "serv");
  const cServ = filho(serv, "cServ");
  const valDps = filho(infDps, "valores");
  const tribMun = desc(valDps, "tribMun");
  const descontos = filho(valDps, "vDescCondIncond");
  const obraEl = filho(serv, "obra");
  const evEl = filho(serv, "atvEvento");
  const valNfse = filho(inf, "valores");
  const emitEl = filho(inf, "emit");

  const emit = pessoaDe(emitEl, "enderNac");
  // O emitente costuma não repetir telefone/e-mail: completa com os da DPS.
  emit.fone = emit.fone || tx(filho(prest, "fone"));
  emit.email = emit.email || tx(filho(prest, "email"));
  emit.im = emit.im || tx(filho(prest, "IM"));

  return {
    chaveAcesso: normalizeInscricao(String(inf.getAttribute("Id") || "").replace(/^NFS/i, "")) || null,
    nNFSe: tx(filho(inf, "nNFSe")),
    cStat: tx(filho(inf, "cStat")),
    dhProc: tx(filho(inf, "dhProc")),
    tpAmb: tx(filho(infDps, "tpAmb")),
    ambGer: tx(filho(inf, "ambGer")),
    xLocEmi: tx(filho(inf, "xLocEmi")),
    xLocPrestacao: tx(filho(inf, "xLocPrestacao")),
    xLocIncid: tx(filho(inf, "xLocIncid")),
    xTribNac: tx(filho(inf, "xTribNac")),
    xTribMun: tx(filho(inf, "xTribMun")),
    xNBS: tx(filho(inf, "xNBS")),
    xOutInf: tx(filho(inf, "xOutInf")),
    emit,
    toma: tomaEl ? pessoaDe(tomaEl, "end") : null,
    dps: {
      nDPS: tx(filho(infDps, "nDPS")),
      serie: tx(filho(infDps, "serie")),
      dhEmi: tx(filho(infDps, "dhEmi")),
      dCompet: tx(filho(infDps, "dCompet")),
      opSimpNac: tx(desc(prest, "opSimpNac")),
      regApTribSN: tx(desc(prest, "regApTribSN")),
      cTribNac: tx(filho(cServ, "cTribNac")),
      cTribMun: tx(filho(cServ, "cTribMun")),
      cNBS: tx(filho(cServ, "cNBS")),
      xDescServ: tx(filho(cServ, "xDescServ")),
      xInfComp: tx(desc(filho(serv, "infoCompl"), "xInfComp")),
      tribISSQN: tx(filho(tribMun, "tribISSQN")),
      tpRetISSQN: tx(filho(tribMun, "tpRetISSQN")),
      pAliq: tx(filho(tribMun, "pAliq")),
      pTotTribSN: tx(desc(filho(desc(valDps, "trib"), "totTrib"), "pTotTribSN")),
      vServ: tx(desc(filho(valDps, "vServPrest"), "vServ")),
      vDescIncond: tx(filho(descontos, "vDescIncond")),
      vDescCond: tx(filho(descontos, "vDescCond")),
      obra: obraEl ? { cObra: tx(filho(obraEl, "cObra")), end: enderecoDe(filho(obraEl, "end")) } : null,
      evento: evEl
        ? {
            xNome: tx(filho(evEl, "xNome")),
            dtIni: tx(filho(evEl, "dtIni")),
            dtFim: tx(filho(evEl, "dtFim")),
            idAtvEvt: tx(filho(evEl, "idAtvEvt")),
            end: enderecoDe(filho(evEl, "end")),
          }
        : null,
    },
    valores: {
      vBC: tx(filho(valNfse, "vBC")),
      pAliqAplic: tx(filho(valNfse, "pAliqAplic")),
      vISSQN: tx(filho(valNfse, "vISSQN")),
      vTotalRet: tx(filho(valNfse, "vTotalRet")),
      vLiq: tx(filho(valNfse, "vLiq")),
    },
  };
}
