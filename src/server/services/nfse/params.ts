import type https from "https";
import {
  consultarConvenio,
  consultarParametrosServico,
  type Ambiente,
} from "./client";

// Municipal parameters cache (convênio + alíquotas por serviço). In-memory,
// TTL-based — same idea as the SERPRO token cache. Municipal parameters change
// rarely; a stale read for a few hours is acceptable.

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

export function getParametrosServico(
  agent: https.Agent,
  amb: Ambiente,
  codigoMunicipio: string,
  codServico: string,
) {
  return memo(`serv:${amb}:${codigoMunicipio}:${codServico}`, () =>
    consultarParametrosServico(agent, amb, codigoMunicipio, codServico),
  );
}

export function clearParamsCache() {
  cache.clear();
}
