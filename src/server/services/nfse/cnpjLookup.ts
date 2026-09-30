import { normalizeCnpj } from "../../../lib/cnpj";
import { NfseError } from "./errors";

// Free CNPJ lookup for the "novo tomador" step: BrasilAPI first (no key, returns
// the IBGE município code we need for the DPS address), ReceitaWS as fallback.
// Only a public CNPJ leaves the server — no client data. Short in-memory cache.

export interface TomadorEndereco {
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  codigoMunicipio: string | null; // IBGE (7)
  uf: string | null;
  cep: string | null;
}

export interface TomadorLookup {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  email: string | null;
  telefone: string | null;
  cnaePrincipal: string | null;
  situacao: string | null;
  endereco: TomadorEndereco;
  fonte: "brasilapi" | "receitaws";
}

const BRASILAPI_BASE = process.env.BRASILAPI_BASE || "https://brasilapi.com.br";
const RECEITAWS_BASE = process.env.RECEITAWS_BASE || "https://receitaws.com.br";
const LOOKUP_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new Map<string, { at: number; data: TomadorLookup }>();

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function digits(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d || null;
}

function clean(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

async function fromBrasilApi(cnpj: string): Promise<TomadorLookup> {
  const d = await getJson(`${BRASILAPI_BASE}/api/cnpj/v1/${cnpj}`);
  return {
    cnpj,
    razaoSocial: clean(d.razao_social) || "",
    nomeFantasia: clean(d.nome_fantasia),
    email: clean(d.email),
    telefone: digits(d.ddd_telefone_1) || digits(d.ddd_telefone_2),
    cnaePrincipal: digits(d.cnae_fiscal),
    situacao: clean(d.descricao_situacao_cadastral),
    endereco: {
      logradouro: [clean(d.descricao_tipo_de_logradouro), clean(d.logradouro)].filter(Boolean).join(" ") || null,
      numero: clean(d.numero),
      complemento: clean(d.complemento),
      bairro: clean(d.bairro),
      municipio: clean(d.municipio),
      codigoMunicipio: digits(d.codigo_municipio_ibge) || digits(d.codigo_municipio),
      uf: clean(d.uf),
      cep: digits(d.cep),
    },
    fonte: "brasilapi",
  };
}

async function fromReceitaWs(cnpj: string): Promise<TomadorLookup> {
  const d = await getJson(`${RECEITAWS_BASE}/v1/cnpj/${cnpj}`);
  if (d.status === "ERROR") throw new Error(d.message || "ReceitaWS erro");
  return {
    cnpj,
    razaoSocial: clean(d.nome) || "",
    nomeFantasia: clean(d.fantasia),
    email: clean(d.email),
    telefone: digits(d.telefone),
    cnaePrincipal: digits(d.atividade_principal?.[0]?.code),
    situacao: clean(d.situacao),
    endereco: {
      logradouro: clean(d.logradouro),
      numero: clean(d.numero),
      complemento: clean(d.complemento),
      bairro: clean(d.bairro),
      municipio: clean(d.municipio),
      codigoMunicipio: null, // ReceitaWS não retorna código IBGE
      uf: clean(d.uf),
      cep: digits(d.cep),
    },
    fonte: "receitaws",
  };
}

export async function lookupCnpj(rawCnpj: string): Promise<TomadorLookup> {
  const cnpj = normalizeCnpj(rawCnpj);
  if (cnpj.length !== 14) {
    throw new NfseError("Informe um CNPJ válido (14 dígitos).", { status: 400, reason: "cnpj_invalido" });
  }

  const hit = cache.get(cnpj);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  let data = await fromBrasilApi(cnpj).catch(() => null);
  if (!data || !data.razaoSocial) data = await fromReceitaWs(cnpj).catch(() => null);

  if (!data || !data.razaoSocial) {
    throw new NfseError(
      "Não foi possível consultar o CNPJ agora. Confira o número ou preencha os dados do tomador manualmente.",
      { status: 502, reason: "lookup_failed" },
    );
  }

  cache.set(cnpj, { at: Date.now(), data });
  return data;
}
