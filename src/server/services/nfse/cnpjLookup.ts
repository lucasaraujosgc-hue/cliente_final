import { normalizeCnpj } from "../../../lib/cnpj";
import { NfseError } from "./errors";
import { nfseLog } from "./log";

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

  // Falha de provedor vai para o log: em produção a consulta falhava sem deixar
  // rastro, e a nota seguia sem o endereço do tomador (rejeição E0235).
  const tentar = (fonte: string, fn: () => Promise<TomadorLookup>) =>
    fn().catch((e) => {
      nfseLog("warn", "cnpj.lookup_falhou", { fonte, msg: e instanceof Error ? e.message : String(e) });
      return null;
    });
  let data = await tentar("brasilapi", () => fromBrasilApi(cnpj));
  if (!data || !data.razaoSocial) data = await tentar("receitaws", () => fromReceitaWs(cnpj));

  if (!data || !data.razaoSocial) {
    throw new NfseError(
      "Não foi possível consultar o CNPJ agora. Confira o número ou preencha os dados do tomador manualmente.",
      { status: 502, reason: "lookup_failed" },
    );
  }

  // Sem código IBGE (ReceitaWS não devolve; BrasilAPI às vezes manda o código
  // TOM de 4 dígitos) o endereço não entra na DPS — completa pelo CEP.
  const end = data.endereco;
  if (String(end.codigoMunicipio || "").length !== 7) {
    end.codigoMunicipio = null;
    if (end.cep && end.cep.length === 8) {
      const viaCep = await lookupCep(end.cep).catch(() => null);
      if (viaCep?.codigoMunicipio) {
        end.codigoMunicipio = viaCep.codigoMunicipio;
        end.municipio = end.municipio || viaCep.municipio;
        end.uf = end.uf || viaCep.uf;
      }
    }
  }

  cache.set(cnpj, { at: Date.now(), data });
  return data;
}

// --- CEP ----------------------------------------------------------------------
//
// Endereço do tomador a partir do CEP — é o que dá o código IBGE do município
// que a DPS exige (toma/end/endNac/cMun), inclusive quando a consulta de CNPJ
// falha ou vem sem ele. Três provedores gratuitos, na ordem; qualquer um basta.
// Só o CEP sai do servidor.

export interface CepLookup {
  cep: string;
  logradouro: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  codigoMunicipio: string | null; // IBGE (7)
  fonte: "viacep" | "opencep" | "brasilapi";
}

const VIACEP_BASE = process.env.VIACEP_BASE || "https://viacep.com.br";
const OPENCEP_BASE = process.env.OPENCEP_BASE || "https://opencep.com";

const cepCache = new Map<string, { at: number; data: CepLookup }>();

function ibge7(v: unknown): string | null {
  const d = digits(v);
  return d && d.length === 7 ? d : null;
}

// ViaCEP e OpenCEP devolvem o mesmo formato.
function fromViaCepShape(cep: string, d: any, fonte: CepLookup["fonte"]): CepLookup {
  if (!d || d.erro) throw new Error("CEP não encontrado");
  return {
    cep,
    logradouro: clean(d.logradouro),
    bairro: clean(d.bairro),
    municipio: clean(d.localidade),
    uf: clean(d.uf),
    codigoMunicipio: ibge7(d.ibge),
    fonte,
  };
}

const CEP_PROVIDERS: Array<[CepLookup["fonte"], (cep: string) => Promise<CepLookup>]> = [
  ["viacep", async (cep) => fromViaCepShape(cep, await getJson(`${VIACEP_BASE}/ws/${cep}/json/`), "viacep")],
  ["opencep", async (cep) => fromViaCepShape(cep, await getJson(`${OPENCEP_BASE}/v1/${cep}`), "opencep")],
  [
    "brasilapi",
    async (cep) => {
      const d = await getJson(`${BRASILAPI_BASE}/api/cep/v2/${cep}`);
      return {
        cep,
        logradouro: clean(d.street),
        bairro: clean(d.neighborhood),
        municipio: clean(d.city),
        uf: clean(d.state),
        codigoMunicipio: ibge7(d.ibge?.city),
        fonte: "brasilapi",
      };
    },
  ],
];

export async function lookupCep(rawCep: string): Promise<CepLookup> {
  const cep = String(rawCep ?? "").replace(/\D/g, "");
  if (cep.length !== 8) {
    throw new NfseError("Informe um CEP válido (8 dígitos).", { status: 400, reason: "cep_invalido" });
  }
  const hit = cepCache.get(cep);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  for (const [fonte, provider] of CEP_PROVIDERS) {
    try {
      const data = await provider(cep);
      // Sem o código IBGE o endereço não serve para a DPS — tenta o próximo.
      if (!data.codigoMunicipio) throw new Error("resposta sem código IBGE");
      cepCache.set(cep, { at: Date.now(), data });
      return data;
    } catch (e) {
      nfseLog("warn", "cep.lookup_falhou", { fonte, cep, msg: e instanceof Error ? e.message : String(e) });
    }
  }
  throw new NfseError(
    "Não foi possível consultar o CEP agora. Confira o número e tente de novo em instantes.",
    { status: 424, reason: "cep_lookup_failed" },
  );
}
