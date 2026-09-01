import { create } from "xmlbuilder2";
import { normalizeCodigoLC116 } from "../../../lib/listaServicosLC116";
import { NfseError } from "./errors";
import {
  normalizeInscricao,
  isCnpj,
  isCpf,
  tipoInscricao,
  inscricaoParaId,
} from "./inscricao";

// Monta o XML da DPS (Declaração de Prestação de Serviços) para o Sistema
// Nacional NFS-e. A ORDEM dos elementos segue a sequência do XSD
// (tiposComplexos_v1.01.xsd, TCInfDPS) exatamente — o validador nacional é
// estrito quanto a isso. Ver services/nfse/validate.ts para a checagem local.
//
// Escopo v1: prestador Simples Nacional / MEI / Normal, um serviço por nota, ISS
// "operação tributável", retenção federal só nos campos monetários simples
// (INSS/IRRF/CSLL). PIS/COFINS com CST, deduções, obra, comércio exterior e os
// blocos IBSCBS (reforma — NT-009, cronograma ainda não publicado) ficam para
// depois.

export const NFSE_NS = "http://www.sped.fazenda.gov.br/nfse";

// Versão do leiaute da DPS. O XSD TVerNFSe aceita "1.00" ou "1.01"; o default
// deve casar com o conjunto de XSD adotado para validação e com o que o ambiente
// (produção restrita / produção) efetivamente aceita. Configurável por env.
export const DPS_VERSAO = process.env.NFSE_DPS_VERSAO || "1.00";
export const VER_APLIC = (process.env.NFSE_VER_APLIC || "portal-virgula-1").slice(0, 20);

// xDescServ: o XSD (TSDesc2000) permite 2000, mas o Anexo I fixa 1000. Adotamos
// o mais restritivo (regra de negócio) — decisão documentada na auditoria.
const XDESC_MAX = 1000;

export interface DpsPrestador {
  cnpj: string; // inscrição federal (14, alfanumérico)
  inscricaoMunicipal?: string | null;
  nome?: string | null;
  regimeTributario: "simples_nacional" | "mei" | "normal";
  regEspTrib?: string | null; // "0".."6","9"
}

export interface DpsEndereco {
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  codigoMunicipio?: string | null; // IBGE 7
  cep?: string | null;
}

export interface DpsTomador {
  doc: string; // CPF (11 dígitos) ou CNPJ (14 alfanumérico)
  nome: string;
  email?: string | null;
  telefone?: string | null;
  inscricaoMunicipal?: string | null;
  endereco?: DpsEndereco | null;
}

export interface DpsServico {
  cTribNac?: string | null; // 6 dígitos — autoritativo
  cTribMun?: string | null;
  itemListaServico?: string | null; // usado só p/ derivar cTribNac quando ausente
  descricao: string;
}

export interface DpsValores {
  valorServicosCentavos: number;
  aliquotaIss: number; // %
  issRetido: boolean;
  exigibilidadeIss: string; // "1".."7"
  retIrrf?: number; // %
  retCsll?: number; // %
  retInss?: number; // %
}

export interface BuildDpsInput {
  ambiente: "homologacao" | "producao";
  serie: string;
  numero: number;
  competencia: string; // "MM/YYYY"
  dhEmi: Date;
  cLocEmi: string; // IBGE 7 (município do prestador)
  cLocPrestacao?: string | null; // default = cLocEmi
  prestador: DpsPrestador;
  tomador?: DpsTomador | null;
  servico: DpsServico;
  valores: DpsValores;
}

export interface BuiltDps {
  xml: string;
  idDps: string;
  numero: number;
  serie: string;
}

function moneyFromCentavos(c: number): string {
  return (Math.round(c) / 100).toFixed(2);
}

function serie5(serie: string): string {
  return String(serie).replace(/\D/g, "").padStart(5, "0").slice(-5);
}

// cTribNac: 6 dígitos. Quando o contador não preencheu, deriva um palpite a
// partir do subitem LC116 ("4.16" -> "041600"). O contador deve sobrescrever.
function resolveCTribNac(servico: DpsServico): string {
  const explicit = String(servico.cTribNac ?? "").replace(/\D/g, "");
  if (explicit.length === 6) return explicit;
  const codigo = normalizeCodigoLC116(servico.itemListaServico || "");
  const m = codigo.match(/^(\d{1,2})\.(\d{2})$/);
  if (m) return `${m[1].padStart(2, "0")}${m[2]}00`;
  throw new NfseError(
    "Código de tributação nacional (6 dígitos) não configurado para esta atividade.",
    { status: 400, reason: "ctribnac_missing" },
  );
}

function opSimpNac(regime: DpsPrestador["regimeTributario"]): "1" | "2" | "3" {
  if (regime === "mei") return "2";
  if (regime === "simples_nacional") return "3";
  return "1";
}

// Brasília é UTC-3 estável (sem horário de verão desde 2019). Municípios em
// -02:00 (Fernando de Noronha) / -04:00 (Manaus) precisariam derivar o offset do
// fuso — fora do escopo v1 (praça de emissão sempre continental sudeste/sul).
function dhEmiUTC(d: Date): string {
  const b = new Date(d.getTime() - 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${b.getUTCFullYear()}-${p(b.getUTCMonth() + 1)}-${p(b.getUTCDate())}T${p(b.getUTCHours())}:${p(b.getUTCMinutes())}:${p(b.getUTCSeconds())}-03:00`;
}

function dCompet(competencia: string): string {
  const m = competencia.match(/^(\d{2})\/(\d{4})$/);
  if (!m) throw new NfseError("Competência inválida (use MM/AAAA).", { status: 400 });
  return `${m[2]}-${m[1]}-01`;
}

export function buildDpsId(cLocEmi: string, prestadorDoc: string, serie: string, numero: number): string {
  const doc = normalizeInscricao(prestadorDoc);
  const tpInsc = tipoInscricao(doc);
  const inscFed = inscricaoParaId(doc);
  const numeroP = String(numero).padStart(15, "0").slice(-15);
  return `DPS${cLocEmi}${tpInsc}${inscFed}${serie5(serie)}${numeroP}`;
}

export function buildDpsXml(input: BuildDpsInput): BuiltDps {
  const inscPrest = normalizeInscricao(input.prestador.cnpj);
  if (!isCnpj(inscPrest)) throw new NfseError("CNPJ do prestador inválido.", { status: 400 });

  const cLocEmi = String(input.cLocEmi || "").replace(/\D/g, "");
  if (cLocEmi.length !== 7) {
    throw new NfseError("Código IBGE do município emissor não configurado (7 dígitos).", {
      status: 400,
      reason: "municipio_missing",
    });
  }

  const numero = Math.trunc(Number(input.numero));
  if (!Number.isFinite(numero) || numero < 1) {
    throw new NfseError("Número da DPS inválido (deve ser ≥ 1).", { status: 500, reason: "ndps_invalido" });
  }

  const idDps = buildDpsId(cLocEmi, inscPrest, input.serie, numero);
  const cLocPrest = String(input.cLocPrestacao || cLocEmi).replace(/\D/g, "") || cLocEmi;
  const cTribNac = resolveCTribNac(input.servico);
  const tomadorDoc = input.tomador ? normalizeInscricao(input.tomador.doc) : "";

  const doc = create({ version: "1.0", encoding: "UTF-8" }).ele(NFSE_NS, "DPS", { versao: DPS_VERSAO });
  const inf = doc.ele("infDPS", { Id: idDps });

  inf.ele("tpAmb").txt(input.ambiente === "producao" ? "1" : "2");
  inf.ele("dhEmi").txt(dhEmiUTC(input.dhEmi));
  inf.ele("verAplic").txt(VER_APLIC);
  inf.ele("serie").txt(serie5(input.serie));
  inf.ele("nDPS").txt(String(numero));
  inf.ele("dCompet").txt(dCompet(input.competencia));
  inf.ele("tpEmit").txt("1"); // 1 = emitido pelo prestador
  inf.ele("cLocEmi").txt(cLocEmi);

  // prest
  const prest = inf.ele("prest");
  prest.ele("CNPJ").txt(inscPrest);
  if (input.prestador.inscricaoMunicipal) prest.ele("IM").txt(String(input.prestador.inscricaoMunicipal));
  if (input.prestador.nome) prest.ele("xNome").txt(input.prestador.nome.slice(0, 150));
  const regTrib = prest.ele("regTrib");
  regTrib.ele("opSimpNac").txt(opSimpNac(input.prestador.regimeTributario));
  regTrib.ele("regEspTrib").txt(String(input.prestador.regEspTrib ?? "0"));

  // toma (opcional)
  if (input.tomador && (isCnpj(tomadorDoc) || isCpf(tomadorDoc))) {
    const toma = inf.ele("toma");
    if (isCnpj(tomadorDoc)) toma.ele("CNPJ").txt(tomadorDoc);
    else toma.ele("CPF").txt(tomadorDoc.replace(/\D/g, "").padStart(11, "0").slice(-11));
    if (input.tomador.inscricaoMunicipal) toma.ele("IM").txt(String(input.tomador.inscricaoMunicipal));
    toma.ele("xNome").txt(input.tomador.nome.slice(0, 150));

    const e = input.tomador.endereco;
    const cMun = String(e?.codigoMunicipio || "").replace(/\D/g, "");
    const cep = String(e?.cep || "").replace(/\D/g, "");
    if (e && e.logradouro && e.numero && e.bairro && cMun.length === 7 && cep.length === 8) {
      const end = toma.ele("end");
      const endNac = end.ele("endNac");
      endNac.ele("cMun").txt(cMun);
      endNac.ele("CEP").txt(cep);
      end.ele("xLgr").txt(e.logradouro.slice(0, 255));
      end.ele("nro").txt(e.numero.slice(0, 60));
      if (e.complemento) end.ele("xCpl").txt(e.complemento.slice(0, 156));
      end.ele("xBairro").txt(e.bairro.slice(0, 60));
    }
    const fone = String(input.tomador.telefone || "").replace(/\D/g, "");
    if (fone.length >= 6) toma.ele("fone").txt(fone.slice(0, 20));
    if (input.tomador.email) toma.ele("email").txt(String(input.tomador.email).slice(0, 80));
  }

  // serv
  const serv = inf.ele("serv");
  serv.ele("locPrest").ele("cLocPrestacao").txt(cLocPrest.length === 7 ? cLocPrest : cLocEmi);
  const cServ = serv.ele("cServ");
  cServ.ele("cTribNac").txt(cTribNac);
  if (input.servico.cTribMun) cServ.ele("cTribMun").txt(String(input.servico.cTribMun).replace(/\D/g, "").slice(0, 3));
  cServ.ele("xDescServ").txt(input.servico.descricao.slice(0, XDESC_MAX));

  // valores
  const valores = inf.ele("valores");
  valores.ele("vServPrest").ele("vServ").txt(moneyFromCentavos(input.valores.valorServicosCentavos));

  const trib = valores.ele("trib");
  const tribMun = trib.ele("tribMun");
  tribMun.ele("tribISSQN").txt("1"); // 1 = operação tributável
  tribMun.ele("tpRetISSQN").txt(input.valores.issRetido ? "2" : "1"); // 2 = retido pelo tomador
  if (input.valores.aliquotaIss > 0) tribMun.ele("pAliq").txt(input.valores.aliquotaIss.toFixed(2));

  const vBase = input.valores.valorServicosCentavos / 100;
  const vRetInss = (vBase * (Number(input.valores.retInss) || 0)) / 100;
  const vRetIrrf = (vBase * (Number(input.valores.retIrrf) || 0)) / 100;
  const vRetCsll = (vBase * (Number(input.valores.retCsll) || 0)) / 100;
  if (vRetInss > 0 || vRetIrrf > 0 || vRetCsll > 0) {
    const tribFed = trib.ele("tribFed");
    if (vRetInss > 0) tribFed.ele("vRetCP").txt(vRetInss.toFixed(2));
    if (vRetIrrf > 0) tribFed.ele("vRetIRRF").txt(vRetIrrf.toFixed(2));
    if (vRetCsll > 0) tribFed.ele("vRetCSLL").txt(vRetCsll.toFixed(2));
  }

  trib.ele("totTrib").ele("indTotTrib").txt("0"); // não informa os tributos totais

  const xml = doc.end({ prettyPrint: false, headless: false });
  return { xml, idDps, numero, serie: input.serie };
}
