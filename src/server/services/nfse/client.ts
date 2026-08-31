import https from "https";
import zlib from "zlib";
import { NfseError } from "./errors";

// HTTP client for the Sefin Nacional NFS-e API. Native https (mirrors
// services/serpro.ts httpsPost) with the per-client mTLS agent. Bodies are JSON;
// the signed XML travels gzip+base64 INSIDE a JSON field, not as Content-Encoding.

const TIMEOUT_MS = 30_000;

export type Ambiente = "homologacao" | "producao";

export function sefinBase(amb: Ambiente): string {
  return amb === "producao"
    ? process.env.NFSE_SEFIN_BASE_PROD || "https://sefin.nfse.gov.br/SefinNacional"
    : process.env.NFSE_SEFIN_BASE_RESTRITA ||
        "https://sefin.producaorestrita.nfse.gov.br/SefinNacional";
}

export function adnBase(amb: Ambiente): string {
  return amb === "producao"
    ? process.env.NFSE_ADN_BASE_PROD || "https://adn.nfse.gov.br"
    : process.env.NFSE_ADN_BASE_RESTRITA || "https://adn.producaorestrita.nfse.gov.br";
}

export function gzipB64(xml: string): string {
  return zlib.gzipSync(Buffer.from(xml, "utf8")).toString("base64");
}

export function ungzipB64(b64: string): string {
  const raw = Buffer.from(b64, "base64");
  try {
    return zlib.gunzipSync(raw).toString("utf8");
  } catch {
    // Some endpoints return plain (un-gzipped) base64.
    return raw.toString("utf8");
  }
}

interface RawResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string | string[] | undefined>;
  buffer: Buffer;
  text(): string;
  json(): any;
}

function request(
  agent: https.Agent | undefined,
  method: string,
  urlStr: string,
  body?: unknown,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), "utf8");
    const opts: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      agent,
      timeout: TIMEOUT_MS,
      headers: {
        Accept: "application/json",
        ...(payload
          ? { "Content-Type": "application/json", "Content-Length": payload.byteLength }
          : {}),
      },
    };
    const req = https.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode || 0,
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          headers: res.headers,
          buffer,
          text: () => buffer.toString("utf8"),
          json: () => JSON.parse(buffer.toString("utf8")),
        });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`Tempo limite ao contatar ${url.hostname}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

// Best-effort extraction of a rejection code/message from a Sefin error body.
function parseRejeicao(res: RawResponse): { codigo?: string; motivo?: string } {
  let body: any;
  try {
    body = res.json();
  } catch {
    return { motivo: res.text().slice(0, 400) || `HTTP ${res.status}` };
  }
  const first =
    (Array.isArray(body?.erros) && body.erros[0]) ||
    (Array.isArray(body?.Erros) && body.Erros[0]) ||
    body?.erro ||
    body;
  const codigo = String(first?.codigo ?? first?.Codigo ?? first?.code ?? body?.tipo ?? "").trim() || undefined;
  const motivo =
    String(
      first?.mensagem ??
        first?.Mensagem ??
        first?.descricao ??
        first?.message ??
        body?.mensagem ??
        body?.title ??
        "",
    ).trim() || `HTTP ${res.status}`;
  return { codigo, motivo };
}

export interface EmitirResult {
  chaveAcesso: string;
  nfseXml: string;
  raw: any;
}

// POST /nfse — geração síncrona.
export async function emitirNfse(
  agent: https.Agent,
  amb: Ambiente,
  dpsXmlAssinado: string,
): Promise<EmitirResult> {
  const res = await request(agent, "POST", `${sefinBase(amb)}/nfse`, {
    dpsXmlGZipB64: gzipB64(dpsXmlAssinado),
  });
  if (!res.ok) {
    const { codigo, motivo } = parseRejeicao(res);
    throw new NfseError(motivo || "NFS-e rejeitada pela Sefin Nacional.", {
      status: res.status === 422 || res.status === 400 ? 422 : 502,
      codigo,
      motivo,
      reason: "rejeitada",
    });
  }
  const body = res.json();
  const nfseXmlGZipB64 = body?.nfseXmlGZipB64 || body?.NfseXmlGZipB64 || body?.nfse;
  return {
    chaveAcesso: String(body?.chaveAcesso || body?.ChaveAcesso || "").replace(/\D/g, ""),
    nfseXml: nfseXmlGZipB64 ? ungzipB64(nfseXmlGZipB64) : "",
    raw: body,
  };
}

// GET /nfse/{chave}
export async function consultarNfse(agent: https.Agent, amb: Ambiente, chave: string): Promise<string> {
  const res = await request(agent, "GET", `${sefinBase(amb)}/nfse/${chave}`);
  if (!res.ok) {
    const { codigo, motivo } = parseRejeicao(res);
    throw new NfseError(motivo, { status: 502, codigo, motivo });
  }
  const body = res.json();
  const b64 = body?.nfseXmlGZipB64 || body?.NfseXmlGZipB64;
  return b64 ? ungzipB64(b64) : res.text();
}

// GET /dps/{id} → chave de acesso
export async function consultarDps(agent: https.Agent, amb: Ambiente, idDps: string): Promise<string | null> {
  const res = await request(agent, "GET", `${sefinBase(amb)}/dps/${idDps}`);
  if (res.status === 404) return null;
  if (!res.ok) return null;
  try {
    const body = res.json();
    return String(body?.chaveAcesso || body?.ChaveAcesso || "").replace(/\D/g, "") || null;
  } catch {
    return null;
  }
}

// POST /nfse/{chave}/eventos — pedido de registro de evento (cancelamento etc).
export async function registrarEvento(
  agent: https.Agent,
  amb: Ambiente,
  chave: string,
  pedidoXmlAssinado: string,
): Promise<{ raw: any; eventoXml: string }> {
  const res = await request(agent, "POST", `${sefinBase(amb)}/nfse/${chave}/eventos`, {
    pedidoRegistroEventoXmlGZipB64: gzipB64(pedidoXmlAssinado),
  });
  if (!res.ok) {
    const { codigo, motivo } = parseRejeicao(res);
    throw new NfseError(motivo || "Evento rejeitado pela Sefin Nacional.", {
      status: res.status === 422 || res.status === 400 ? 422 : 502,
      codigo,
      motivo,
      reason: "evento_rejeitado",
    });
  }
  const body = res.json();
  const b64 = body?.eventoXmlGZipB64 || body?.EventoXmlGZipB64;
  return { raw: body, eventoXml: b64 ? ungzipB64(b64) : "" };
}

// GET {adn}/danfse/{chave} → PDF bytes.
export async function baixarDanfse(
  agent: https.Agent | undefined,
  amb: Ambiente,
  chave: string,
): Promise<Buffer> {
  const res = await request(agent, "GET", `${adnBase(amb)}/danfse/${chave}`);
  if (!res.ok || res.buffer.length === 0) {
    throw new NfseError("DANFSE não disponível para esta chave.", { status: 502, reason: "danfse_unavailable" });
  }
  return res.buffer;
}

// GET /parametros_municipais/{cod}/convenio
export async function consultarConvenio(
  agent: https.Agent,
  amb: Ambiente,
  codigoMunicipio: string,
): Promise<{ aderente: boolean; raw: any }> {
  const res = await request(agent, "GET", `${sefinBase(amb)}/parametros_municipais/${codigoMunicipio}/convenio`);
  if (res.status === 404) return { aderente: false, raw: null };
  if (!res.ok) {
    const { motivo } = parseRejeicao(res);
    throw new NfseError(motivo, { status: 502, reason: "convenio_erro" });
  }
  const raw = res.json();
  // Different shapes seen; treat any 2xx with a payload as "conveniado".
  const aderente =
    raw?.aderente ??
    raw?.municipioAderente ??
    (raw?.parametrosConvenio ? true : undefined) ??
    true;
  return { aderente: Boolean(aderente), raw };
}

// GET /parametros_municipais/{cod}/{codServico}
export async function consultarParametrosServico(
  agent: https.Agent,
  amb: Ambiente,
  codigoMunicipio: string,
  codServico: string,
): Promise<any> {
  const res = await request(
    agent,
    "GET",
    `${sefinBase(amb)}/parametros_municipais/${codigoMunicipio}/${codServico}`,
  );
  if (!res.ok) return null;
  try {
    return res.json();
  } catch {
    return null;
  }
}
