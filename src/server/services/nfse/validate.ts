import { DOMParser } from "@xmldom/xmldom";
import { NFSE_NS } from "./dps";
import { NfseError } from "./errors";

// Validação ESTRUTURAL do XML da DPS / pedido de registro de evento antes do
// envio ao Sefin Nacional.
//
// Não substitui a validação XSD completa (planejada para o CI, usando os
// esquemas de docs/nfse-nacional/03-xsd/). É uma barreira local, derivada
// diretamente do XSD v1.01, que pega as classes de erro que de fato corremos:
//   E1228 — prefixo de namespace na área de dados
//   E1229 — codificação diferente de UTF-8
//   E1235 — falha de esquema: elemento fora de ordem / obrigatório ausente
//   E1260 — versão do leiaute fora da faixa aceita
// e os patterns dos tipos simples usados no nosso subconjunto (CNPJ alfanumérico
// incluído).

const VERSAO_OK = /^1\.(00|01)$/;
const RE_ID_DPS = /^DPS[0-9]{7}(1[0-9]{14}|2[0-9A-Z]{14})[0-9]{20}$/;
const RE_ID_PEDREG = /^PRE[0-9]{8}(1[0-9]{14}|2[0-9A-Z]{14})[0-9]{33}$/;
const RE_DHUTC =
  /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d[-+](0[0-9]|1[0-4]):00$/;
const RE_DATA = /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const RE_SERIE = /^([0-9]{1,4}|[0-8][0-9]{4})$/;
const RE_NDPS = /^[1-9][0-9]{0,14}$/;
const RE_MUN = /^[0-9]{7}$/;
const RE_CTRIBNAC = /^[0-9]{6}$/;

// Sequência de TCInfDPS (tiposComplexos_v1.01.xsd l.744). `?` = minOccurs=0.
const INFDPS_SEQ = [
  "tpAmb",
  "dhEmi",
  "verAplic",
  "serie",
  "nDPS",
  "dCompet",
  "tpEmit",
  "cMotivoEmisTI?",
  "chNFSeRej?",
  "cLocEmi",
  "subst?",
  "prest",
  "toma?",
  "interm?",
  "serv",
  "valores",
  "IBSCBS?",
];

// Sequência de TCInfPedReg (tiposEventos_v1.01.xsd l.78). O grupo do autor é um
// choice CNPJAutor|CPFAutor; o evento específico é um choice e######.
const INFPEDREG_SEQ = ["tpAmb", "verAplic", "dhEvento", "@autor", "chNFSe", "@evento"];
const AUTOR_CHOICE = ["CNPJAutor", "CPFAutor"];
const EVENTO_PREFIX = /^e\d{6}$/;

function fail(msg: string, path: string): never {
  throw new NfseError(`XML inválido (${path}): ${msg}`, {
    status: 422,
    reason: "xml_invalido",
    motivo: msg,
  });
}

function elementChildren(node: any): any[] {
  const out: any[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1) out.push(c);
  }
  return out;
}

function localName(el: any): string {
  return el.localName || String(el.nodeName || "").replace(/^.*:/, "");
}

// E1228 — nenhum elemento pode usar prefixo de namespace.
function assertNoPrefixes(el: any, path: string): void {
  if (String(el.nodeName || "").includes(":")) {
    fail(`elemento com prefixo de namespace não é permitido ("${el.nodeName}")`, path);
  }
  for (const child of elementChildren(el)) {
    assertNoPrefixes(child, `${path}/${localName(child)}`);
  }
}

function checkSequence(
  children: any[],
  seq: string[],
  path: string,
  isEvento = false,
): void {
  let ci = 0;
  for (const spec of seq) {
    const optional = spec.endsWith("?");
    const name = spec.replace(/\?$/, "");
    const child = children[ci];
    const childName = child ? localName(child) : null;

    if (name === "@autor") {
      if (!childName || !AUTOR_CHOICE.includes(childName)) {
        fail(`esperado ${AUTOR_CHOICE.join(" ou ")}, encontrado "${childName ?? "(fim)"}"`, path);
      }
      ci++;
      continue;
    }
    if (name === "@evento") {
      if (!childName || !EVENTO_PREFIX.test(childName)) {
        fail(`esperado elemento de evento (e######), encontrado "${childName ?? "(fim)"}"`, path);
      }
      ci++;
      continue;
    }
    if (childName === name) {
      ci++;
      continue;
    }
    if (!optional) {
      fail(`elemento obrigatório "${name}" ausente ou fora de ordem (encontrado "${childName ?? "(fim)"}")`, path);
    }
  }
  if (ci < children.length) {
    fail(`elemento inesperado "${localName(children[ci])}" após a sequência conhecida`, path);
  }
  void isEvento;
}

function textOf(el: any): string {
  return String(el?.textContent ?? "").trim();
}

function childByName(parent: any, name: string): any | null {
  return elementChildren(parent).find((c) => localName(c) === name) ?? null;
}

function parse(xml: string): any {
  if (!/^\s*<\?xml[^>]*encoding\s*=\s*["']utf-8["']/i.test(xml)) {
    fail('a declaração XML deve indicar encoding="UTF-8"', "xml");
  }
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (_level: string, m: string) => errors.push(m),
  } as any).parseFromString(xml, "text/xml");
  if (errors.length) fail(errors[0], "xml");
  return doc;
}

/** Valida a DPS assinada (ou não) antes de POST /nfse. */
export function validateDps(xml: string, opts: { requireSignature?: boolean } = {}): void {
  const doc = parse(xml);
  const root = doc.documentElement;
  if (!root || localName(root) !== "DPS") fail('elemento raiz deve ser "DPS"', "DPS");
  if (root.namespaceURI && root.namespaceURI !== NFSE_NS) {
    fail(`namespace incorreto (${root.namespaceURI})`, "DPS");
  }
  if (!VERSAO_OK.test(root.getAttribute("versao") || "")) {
    fail(`versão do leiaute inválida ("${root.getAttribute("versao")}") — use 1.00 ou 1.01`, "DPS/@versao");
  }
  assertNoPrefixes(root, "DPS");

  const inf = childByName(root, "infDPS");
  if (!inf) fail('grupo "infDPS" ausente', "DPS");
  const id = inf.getAttribute("Id") || "";
  if (!RE_ID_DPS.test(id)) fail(`Id da DPS fora do padrão TSIdDPS ("${id}")`, "DPS/infDPS/@Id");

  const kids = elementChildren(inf);
  checkSequence(kids, INFDPS_SEQ, "DPS/infDPS");

  // patterns dos tipos simples do nosso subconjunto
  const path = "DPS/infDPS";
  const tpAmb = textOf(childByName(inf, "tpAmb"));
  if (tpAmb !== "1" && tpAmb !== "2") fail(`tpAmb deve ser 1 ou 2 ("${tpAmb}")`, `${path}/tpAmb`);
  if (!RE_DHUTC.test(textOf(childByName(inf, "dhEmi"))))
    fail(`dhEmi fora do formato UTC ("${textOf(childByName(inf, "dhEmi"))}")`, `${path}/dhEmi`);
  if (!RE_SERIE.test(textOf(childByName(inf, "serie"))))
    fail(`série fora do padrão ("${textOf(childByName(inf, "serie"))}")`, `${path}/serie`);
  if (!RE_NDPS.test(textOf(childByName(inf, "nDPS"))))
    fail(`nDPS deve ser 1..999999999999999 ("${textOf(childByName(inf, "nDPS"))}")`, `${path}/nDPS`);
  if (!RE_DATA.test(textOf(childByName(inf, "dCompet"))))
    fail(`dCompet fora do formato AAAA-MM-DD ("${textOf(childByName(inf, "dCompet"))}")`, `${path}/dCompet`);
  if (!RE_MUN.test(textOf(childByName(inf, "cLocEmi"))))
    fail(`cLocEmi deve ter 7 dígitos ("${textOf(childByName(inf, "cLocEmi"))}")`, `${path}/cLocEmi`);

  const prest = childByName(inf, "prest");
  const prestId = elementChildren(prest)[0];
  if (!prestId || !["CNPJ", "CPF", "NIF", "cNaoNIF"].includes(localName(prestId)))
    fail("prest deve começar por CNPJ/CPF/NIF/cNaoNIF", `${path}/prest`);
  const regTrib = childByName(prest, "regTrib");
  if (!regTrib) fail('prest/regTrib obrigatório', `${path}/prest`);
  if (!childByName(regTrib, "opSimpNac") || !childByName(regTrib, "regEspTrib"))
    fail("regTrib requer opSimpNac e regEspTrib", `${path}/prest/regTrib`);

  const serv = childByName(inf, "serv");
  const cServ = childByName(serv, "cServ");
  if (!RE_CTRIBNAC.test(textOf(childByName(cServ, "cTribNac"))))
    fail(`cTribNac deve ter 6 dígitos ("${textOf(childByName(cServ, "cTribNac"))}")`, `${path}/serv/cServ/cTribNac`);

  const sig = childByName(root, "Signature");
  if (opts.requireSignature && !sig) fail("assinatura (Signature) ausente", "DPS/Signature");
  if (sig) {
    const after = root.lastChild && localName(root.lastChild) === "Signature";
    if (!after) fail("Signature deve ser o último filho de DPS (após infDPS)", "DPS/Signature");
  }
}

/** Valida o pedido de registro de evento antes de POST /nfse/{chave}/eventos. */
export function validatePedRegEvento(xml: string, opts: { requireSignature?: boolean } = {}): void {
  const doc = parse(xml);
  const root = doc.documentElement;
  if (!root || localName(root) !== "pedRegEvento")
    fail('elemento raiz deve ser "pedRegEvento"', "pedRegEvento");
  if (!VERSAO_OK.test(root.getAttribute("versao") || ""))
    fail(`versão inválida ("${root.getAttribute("versao")}")`, "pedRegEvento/@versao");
  assertNoPrefixes(root, "pedRegEvento");

  const inf = childByName(root, "infPedReg");
  if (!inf) fail('grupo "infPedReg" ausente', "pedRegEvento");
  const id = inf.getAttribute("Id") || "";
  if (!RE_ID_PEDREG.test(id))
    fail(`Id do pedido fora do padrão TSIdPedRegEvt ("${id}")`, "pedRegEvento/infPedReg/@Id");

  checkSequence(elementChildren(inf), INFPEDREG_SEQ, "pedRegEvento/infPedReg", true);

  const sig = childByName(root, "Signature");
  if (opts.requireSignature && !sig) fail("assinatura (Signature) ausente", "pedRegEvento/Signature");
}
