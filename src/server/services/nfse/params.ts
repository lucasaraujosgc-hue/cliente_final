import type https from "https";
import { consultarConvenio, consultarAliquota, type Ambiente } from "./client";

// Cache dos parâmetros municipais (convênio + alíquota por serviço). Em memória,
// TTL — mesma ideia do cache de token do SERPRO. Parâmetros municipais mudam
// raramente; uma leitura defasada por algumas horas é aceitável.

interface CacheEntry {
  at: number;
  data: unknown;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 6 * 60 * 60 * 1000;

function memo<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data as T);
  return fetcher().then((data) => {
    cache.set(key, { at: Date.now(), data });
    return data;
  });
}

export function getConvenio(agent: https.Agent, amb: Ambiente, codigoMunicipio: string) {
  return memo(`conv:${amb}:${codigoMunicipio}`, () =>
    consultarConvenio(agent, amb, codigoMunicipio),
  );
}

// Alíquota do ISSQN parametrizada pelo município para um código de serviço e
// competência. `null` quando o município não parametriza (não conveniado) — aí
// o emitente informa a alíquota na DPS.
export function getAliquotaParametrizada(
  agent: https.Agent,
  amb: Ambiente,
  codigoMunicipio: string,
  codServico: string,
  competenciaIso: string,
): Promise<number | null> {
  return memo(`aliq:${amb}:${codigoMunicipio}:${codServico}:${competenciaIso}`, () =>
    consultarAliquota(agent, amb, codigoMunicipio, codServico, competenciaIso),
  );
}

export function clearParamsCache() {
  cache.clear();
}
