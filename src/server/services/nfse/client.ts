import https from "https";
import zlib from "zlib";
import { NfseError } from "./errors";

// Cliente HTTP para as APIs do Sistema Nacional NFS-e. `https` nativo (espelha
// services/serpro.ts httpsPost) com o agente mTLS por cliente. Corpo em JSON; o
// XML assinado trafega gzip+base64 DENTRO de um campo JSON (não como
// Content-Encoding).
//
// Contrato confirmado nos Swaggers oficiais salvos em
// docs/nfse-nacional/01-api/:
//   - swagger-sefin-nacional-producao.json          (host sefin.nfse.gov.br)
//   - swagger-sefin-nacional-producao-restrita.json (host sefin.producaorestrita.nfse.gov.br)
//   - swagger-adn-parametros-municipais.json         (adn .../parametrizacao)
//   - swagger-adn-danfse.json                        (adn .../danfse)
//
// Emissão/consulta/eventos: POST /nfse, GET /nfse/{chave}, GET|HEAD /dps/{id},
// POST /nfse/{chave}/eventos, GET /nfse/{chave}/eventos/{tipo}/{seq}.
// Sucesso do POST = HTTP 201. Rejeição = 400; certificado de transmissão = 403;
// falha interna (ambígua) = 500. Parâmetros municipais e DANFSe foram movidos
// do Sefin para o ADN (o Sefin responde 501 nesses paths).

const TIMEOUT_MS = 30_000;

export type Ambiente = "homologacao" | "producao";

export function sefinBase(amb: Ambiente): string {
  return amb === "producao"
    ? process.env.NFSE_SEFIN_BASE_PROD || "https://sefin.nfse.gov.br/SefinNacional"
    : process.env.NFSE_SEFIN_BASE_RESTRITA ||
        "https://sefin.producaorestrita.nfse.gov.br/SefinNacional";
}

// Parâmetros municipais (convênio, alíquotas, regimes, retenções, benefícios) —
// movidos do Sefin para o ADN "/parametrizacao".
export function paramBase(amb: Ambiente): string {
  return amb === "producao"
    ? process.env.NFSE_PARAM_BASE_PROD || "https://adn.nfse.gov.br/parametrizacao"
    : process.env.NFSE_PARAM_BASE_RESTRITA ||
        "https://adn.producaorestrita.nfse.gov.br/parametrizacao";
}

// DANFSe — movido do Sefin para o ADN "/danfse". Ver NT-008: a partir de
// 03/08/2026 este serviço está sobrestado e o emissor deve gerar o DANFSe
// localmente (services/nfse/danfseRender.ts). Mantido como tentativa oportunista.
export function danfseBase(amb: Ambiente): string {
  return amb === "producao"
    ? process.env.NFSE_ADN_BASE_PROD
      ? `${process.env.NFSE_ADN_BASE_PROD}/danfse`
      : "https://adn.nfse.gov.br/danfse"
    : process.env.NFSE_ADN_BASE_RESTRITA
      ? `${process.env.NFSE_ADN_BASE_RESTRITA}/danfse`
      : "https://adn.producaorestrita.nfse.gov.br/danfse";
}

export function gzipB64(xml: string): string {
  return zlib.gzipSync(Buffer.from(xml, "utf8")).toString("base64");
}

export function ungzipB64(b64: string): string {
  const raw = Buffer.from(String(b64 || ""), "base64");
  try {
    return zlib.gunzipSync(raw).toString("utf8");
  } catch {
    // Algumas rotas devolvem base64 puro (sem gzip).
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

// MensagemProcessamento { mensagem, codigo, descricao, complemento }
export interface MensagemSefin {
  codigo: string | null;
  mensagem: string | null;
}

function msg(m: any): MensagemSefin {
  if (!m || typeof m !== "object") return { codigo: null, mensagem: m ? String(m) : null };
  const codigo = String(m.codigo ?? m.Codigo ?? "").trim() || null;
  const mensagem =
    String(m.descricao ?? m.Descricao ?? m.mensagem ?? m.Mensagem ?? "").trim() || null;
  const complemento = String(m.complemento ?? m.Complemento ?? "").trim();
  return { codigo, mensagem: complemento && mensagem ? `${mensagem} — ${complemento}` : mensagem };
}

// Extrai a lista de mensagens (erros ou alertas) de um corpo do Sefin, tolerando
// as duas formas do Swagger: `erros: MensagemProcessamento[]` (POST) e
// `erro: MensagemProcessamento` (GET / ResponseErro).
function extractMensagens(body: any, key: "erros" | "alertas"): MensagemSefin[] {
  if (!body || typeof body !== "object") return [];
  const arr = body[key] ?? body[key === "erros" ? "Erros" : "Alertas"];
  if (Array.isArray(arr)) return arr.map(msg);
  const single = body.erro ?? body.Erro;
  if (key === "erros" && single) return [msg(single)];
  if (key === "erros" && (body.mensagem || body.descricao)) return [msg(body)];
  return [];
}

// Junta TUDO que o Sefin devolveu para o diagnóstico: código do 1º erro +
// todas as mensagens (com complemento) numa string. Quando o corpo não tem a
// forma esperada, inclui o HTTP status e um trecho do corpo cru.
function firstErro(res: RawResponse): { codigo?: string; motivo: string } {
  let body: any;
  try {
    body = res.json();
  } catch {
    return { motivo: `HTTP ${res.status} — ${res.text().slice(0, 500) || "(corpo vazio)"}` };
  }
  const erros = extractMensagens(body, "erros");
  const alertas = extractMensagens(body, "alertas");
  const todos = [...erros, ...alertas].filter((m) => m.mensagem);

  if (todos.length) {
    const partes = todos.map((m) => (m.codigo ? `[${m.codigo}] ${m.mensagem}` : m.mensagem));
    return { codigo: erros[0]?.codigo || undefined, motivo: partes.join(" | ") };
  }

  // Sem lista de erros reconhecível — devolve o que der (mensagem/título de topo
  // ou um recorte do JSON) para não perder o motivo real.
  const topo =
    String(body?.mensagem ?? body?.Mensagem ?? body?.title ?? body?.detail ?? "").trim();
  const cru = JSON.stringify(body).slice(0, 600);
  return { motivo: `HTTP ${res.status}${topo ? ` — ${topo}` : ""} · ${cru}` };
}

// ---- POST /nfse ------------------------------------------------------------

export interface EmitirResult {
  status: number;
  chaveAcesso: string;
  idDps: string;
  nfseXml: string;
  alertas: MensagemSefin[];
  versaoAplicativo: string | null;
  processadoEm: string | null;
  raw: any;
}

export async function emitirNfse(
  agent: https.Agent,
  amb: Ambiente,
  dpsXmlAssinado: string,
): Promise<EmitirResult> {
  const res = await request(agent, "POST", `${sefinBase(amb)}/nfse`, {
    dpsXmlGZipB64: gzipB64(dpsXmlAssinado),
  });

  if (res.status === 201 || res.ok) {
    let body: any = {};
    try {
      body = res.json();
    } catch {
      /* corpo não-JSON num 2xx — anomalia; tratada em emitir.ts */
    }
    const b64 = body?.nfseXmlGZipB64 ?? body?.NfseXmlGZipB64 ?? body?.nfse;
    return {
      status: res.status,
      chaveAcesso: String(body?.chaveAcesso ?? body?.ChaveAcesso ?? "").trim().toUpperCase(),
      idDps: String(body?.idDps ?? body?.idDPS ?? body?.IdDps ?? "").trim(),
      nfseXml: b64 ? ungzipB64(b64) : "",
      alertas: extractMensagens(body, "alertas"),
      versaoAplicativo: String(body?.versaoAplicativo ?? "").trim() || null,
      processadoEm: String(body?.dataHoraProcessamento ?? "").trim() || null,
      raw: body,
    };
  }

  // Certificado de transmissão inválido / fora do padrão — não é rejeição de
  // regra de negócio; o operador precisa reenviar um A1 válido.
  if (res.status === 403) {
    const { motivo } = firstErro(res);
    throw new NfseError(
      motivo || "Certificado digital de transmissão inválido ou fora do padrão da NFS-e.",
      { status: 502, reason: "cert_transmissao", motivo },
    );
  }

  // Falha interna do Sefin: pode ou não ter gerado a NFS-e. Ambíguo — o caller
  // grava 'processando' e reconcilia por GET /dps/{id}.
  if (res.status >= 500) {
    let idDps = "";
    try {
      idDps = String(res.json()?.idDPS ?? res.json()?.idDps ?? "").trim();
    } catch {
      /* ignore */
    }
    const { motivo } = firstErro(res);
    throw new NfseError(motivo || "Falha no processamento da DPS pelo Sefin Nacional.", {
      status: 502,
      reason: "sefin_indisponivel",
      motivo,
      codigo: idDps || undefined,
    });
  }

  // 400 e demais 4xx: rejeição por regra de negócio / esquema.
  const { codigo, motivo } = firstErro(res);
  throw new NfseError(motivo || "NFS-e rejeitada pela Sefin Nacional.", {
    status: 422,
    codigo,
    motivo,
    reason: "rejeitada",
  });
}

// ---- GET /nfse/{chave} ----------------------------------------------------

export async function consultarNfse(
  agent: https.Agent,
  amb: Ambiente,
  chave: string,
): Promise<{ nfseXml: string; raw: any } | null> {
  const res = await request(agent, "GET", `${sefinBase(amb)}/nfse/${chave}`);
  if (res.status === 404) return null;
  if (res.status === 403) {
    throw new NfseError("Consulta desta NFS-e não é permitida para este certificado.", {
      status: 403,
      reason: "consulta_negada",
    });
  }
  if (!res.ok) {
    const { codigo, motivo } = firstErro(res);
    throw new NfseError(motivo, { status: 502, codigo, motivo });
  }
  const body = res.json();
  const b64 = body?.nfseXmlGZipB64 ?? body?.NfseXmlGZipB64;
  return { nfseXml: b64 ? ungzipB64(b64) : "", raw: body };
}

// ---- GET / HEAD /dps/{id} -----------------------------------------------

export async function consultarDps(
  agent: https.Agent,
  amb: Ambiente,
  idDps: string,
): Promise<string | null> {
  const res = await request(agent, "GET", `${sefinBase(amb)}/dps/${idDps}`);
  if (res.status === 404) return null;
  if (!res.ok) return null;
  try {
    const body = res.json();
    return String(body?.chaveAcesso ?? body?.ChaveAcesso ?? "").trim().toUpperCase() || null;
  } catch {
    return null;
  }
}

// HEAD — atende qualquer certificado válido, sem sigilo fiscal. Usado para saber
// se um número de DPS já gerou NFS-e (idempotência / reconciliação).
export async function headDps(agent: https.Agent, amb: Ambiente, idDps: string): Promise<boolean> {
  const res = await request(agent, "HEAD", `${sefinBase(amb)}/dps/${idDps}`);
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new NfseError(`Consulta HEAD /dps falhou (HTTP ${res.status}).`, { status: 502 });
}

// ---- POST /nfse/{chave}/eventos ----------------------------------------

export async function registrarEvento(
  agent: https.Agent,
  amb: Ambiente,
  chave: string,
  pedidoXmlAssinado: string,
): Promise<{ raw: any; eventoXml: string }> {
  const res = await request(agent, "POST", `${sefinBase(amb)}/nfse/${chave}/eventos`, {
    pedidoRegistroEventoXmlGZipB64: gzipB64(pedidoXmlAssinado),
  });
  if (res.status !== 201 && !res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new NfseError("Certificado sem permissão para registrar eventos desta NFS-e.", {
        status: 403,
        reason: "evento_negado",
      });
    }
    const { codigo, motivo } = firstErro(res);
    throw new NfseError(motivo || "Evento rejeitado pela Sefin Nacional.", {
      status: res.status >= 500 ? 502 : 422,
      codigo,
      motivo,
      reason: "evento_rejeitado",
    });
  }
  const body = res.json();
  const b64 = body?.eventoXmlGZipB64 ?? body?.EventoXmlGZipB64;
  return { raw: body, eventoXml: b64 ? ungzipB64(b64) : "" };
}

// ---- GET {adn}/danfse/{chave} → PDF bytes -----------------------------

export async function baixarDanfse(
  agent: https.Agent | undefined,
  amb: Ambiente,
  chave: string,
): Promise<Buffer> {
  const res = await request(agent, "GET", `${danfseBase(amb)}/${chave}`);
  // 501 = serviço sobrestado (NT-008); 404 = ainda não disponível.
  if (res.status === 501 || res.status === 404 || !res.ok || res.buffer.length === 0) {
    throw new NfseError("DANFSe não disponível pela API — será gerado localmente.", {
      status: 502,
      reason: "danfse_indisponivel",
    });
  }
  return res.buffer;
}

// ---- Parâmetros municipais (ADN /parametrizacao) ---------------------

// GET /{cod}/convenio → ResultadoConsultaConfiguracoesConvenio
export async function consultarConvenio(
  agent: https.Agent,
  amb: Ambiente,
  codigoMunicipio: string,
): Promise<{ aderente: boolean; raw: any }> {
  const res = await request(
    agent,
    "GET",
    `${paramBase(amb)}/${codigoMunicipio}/convenio`,
  );
  if (res.status === 404) return { aderente: false, raw: null };
  if (!res.ok) {
    const { motivo } = firstErro(res);
    throw new NfseError(motivo, { status: 502, reason: "convenio_erro" });
  }
  const raw = res.json();
  const pc = raw?.parametrosConvenio ?? raw?.ParametrosConvenio ?? {};
  // TipoSimNao: 1 = Sim. "aderenteEmissorNacional" = o convênio permite que os
  // contribuintes do município usem os emissores públicos nacionais.
  const aderente =
    Number(pc?.aderenteEmissorNacional) === 1 ||
    Number(pc?.aderenteAmbienteNacional) === 1;
  return { aderente, raw };
}

// GET /{cod}/{codServico}/{competencia}/aliquota → ResultadoConsultaAliquotas
export async function consultarAliquota(
  agent: https.Agent,
  amb: Ambiente,
  codigoMunicipio: string,
  codServico: string,
  competenciaIso: string, // "AAAA-MM-DD"
): Promise<number | null> {
  const res = await request(
    agent,
    "GET",
    `${paramBase(amb)}/${codigoMunicipio}/${codServico}/${competenciaIso}/aliquota`,
  );
  if (!res.ok) return null;
  try {
    const raw = res.json();
    const groups = raw?.aliquotas ?? raw?.Aliquotas ?? {};
    for (const key of Object.keys(groups)) {
      const list = groups[key];
      const first = Array.isArray(list) ? list[0] : null;
      const aliq = Number(first?.Aliq ?? first?.aliq);
      if (Number.isFinite(aliq)) return aliq;
    }
    return null;
  } catch {
    return null;
  }
}
