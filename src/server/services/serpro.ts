import https from "https";
import fs from "fs";
import { db } from "../db";
import { serproConfig } from "../schema";
import { decryptSecret, decryptBytes } from "./secretbox";

export function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export interface SerproContext {
  config: any; // serpro_config row with consumerSecret/certSenha decrypted
  cnpjContratante: string;
  baseUrl: string;
  certAgent?: https.Agent;
}

// Reads serpro_config once, decrypts the secrets in memory, resolves the
// trial/prod base URL and (in production) builds the mTLS agent from the stored
// .pfx. Used by both "gerar guia" and "consultar pagamento" so the SERPRO wiring
// lives in one place. Throws a tagged error the callers turn into a 4xx / a
// "not_configured" outcome.
export async function buildSerproContext(): Promise<SerproContext> {
  const rows = await db.select().from(serproConfig).limit(1);
  if (rows.length === 0 || !rows[0].consumerKey) {
    throw Object.assign(new Error("Integra Contador não configurado. Acesse as configurações."), {
      status: 400,
      reason: "not_configured",
    });
  }

  const config = {
    ...rows[0],
    consumerSecret: decryptSecret(rows[0].consumerSecret),
    certSenha: decryptSecret(rows[0].certSenha),
  };

  const cnpjContratante = config.cnpjContratante
    ? config.cnpjContratante.replace(/\D/g, "")
    : "00000000000100";

  const baseUrl =
    config.ambiente === "producao"
      ? "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1"
      : "https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1";

  let certAgent: https.Agent | undefined;
  if (config.ambiente === "producao") {
    if (!config.certPath) {
      throw Object.assign(
        new Error(
          "Certificado digital não configurado. Reenvie o arquivo .pfx/.p12 nas configurações do Integra Contador.",
        ),
        { status: 400, reason: "cert_missing" },
      );
    }
    try {
      const pfx = decryptBytes(await fs.promises.readFile(config.certPath));
      certAgent = new https.Agent({
        pfx,
        passphrase: config.certSenha || "",
        rejectUnauthorized: true,
      });
    } catch (err: any) {
      console.error("Certificado SERPRO configurado não pode ser lido:", {
        path: config.certPath,
        code: err?.code,
        message: err?.message,
      });
      throw Object.assign(
        new Error(
          "Certificado digital não encontrado no servidor. Reenvie o arquivo .pfx/.p12 nas configurações do Integra Contador.",
        ),
        { status: 400, reason: "cert_missing" },
      );
    }
  }

  return { config, cnpjContratante, baseUrl, certAgent };
}

interface TokenCache {
  access_token: string;
  jwt_token: string;
  expiresAt: number;
}
const serproTokenCache: { [key: string]: TokenCache } = {};

// Upper bound on any single SERPRO HTTP call. Without it a hung SERPRO endpoint
// keeps the Express request (and its DB work) pending indefinitely.
const SERPRO_HTTP_TIMEOUT_MS = 30_000;

// Helper HTTP nativo (evita problemas com node-fetch ESM)
function httpsPost(
  urlStr: string,
  headers: Record<string, string>,
  body: string,
  agent?: any,
): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyBuf = Buffer.from(body, "utf8");
    const opts: any = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: "POST",
      headers: { ...headers, "Content-Length": bodyBuf.byteLength },
      timeout: SERPRO_HTTP_TIMEOUT_MS,
    };
    if (agent) opts.agent = agent;

    const req = https.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: res.statusCode! >= 200 && res.statusCode! < 300,
          status: res.statusCode!,
          text: async () => text,
          json: async () => JSON.parse(text),
        });
      });
    });
    req.on("error", reject);
    // 'timeout' fires on socket inactivity but does not abort — do it here so
    // the promise rejects instead of hanging forever.
    req.on("timeout", () => {
      req.destroy(
        new Error(
          `Tempo limite de ${SERPRO_HTTP_TIMEOUT_MS / 1000}s excedido ao contatar ${url.hostname}`,
        ),
      );
    });
    req.write(bodyBuf);
    req.end();
  });
}

export async function getSerproToken(config: any, agent?: any): Promise<{ access_token: string; jwt_token: string }> {
  const cacheKey = `${config.consumerKey}:${config.ambiente}`;
  const cached = serproTokenCache[cacheKey];

  // Reutiliza o token se estiver válido e faltar mais de 5 minutos para expirar
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return { access_token: cached.access_token, jwt_token: cached.jwt_token };
  }

  const credentials = Buffer.from(
    `${config.consumerKey}:${config.consumerSecret}`
  ).toString("base64");

  const resp = await httpsPost(
    "https://autenticacao.sapi.serpro.gov.br/authenticate",
    {
      Authorization: `Basic ${credentials}`,
      "role-type": "TERCEIROS",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    "grant_type=client_credentials",
    agent,
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Erro ao obter token SERPRO: ${resp.status} - ${errText}`);
  }
  const data = await resp.json() as any;

  const expiresIn = data.expires_in || 3600;
  const entry: TokenCache = {
    access_token: data.access_token,
    jwt_token: data.jwt_token || "",
    expiresAt: Date.now() + expiresIn * 1000,
  };
  serproTokenCache[cacheKey] = entry;

  return { access_token: entry.access_token, jwt_token: entry.jwt_token };
}

export async function serproPost(
  url: string,
  tokens: { access_token: string; jwt_token: string },
  payload: any,
  agent?: any,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.access_token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Cache-Control": "no-cache",
  };
  if (tokens.jwt_token) headers["jwt_token"] = tokens.jwt_token;

  return httpsPost(url, headers, JSON.stringify(payload), agent);
}
