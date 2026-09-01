import fs from "fs";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { clients, nfseAtividades, nfseConfig, nfseEmissoes } from "../../schema";
import {
  encryptBytes,
  encryptSecret,
  decryptSecret,
  decryptBytes,
  secretsEncryptionEnabled,
} from "../secretbox";
import { formatCnpj } from "../../../lib/cnpj";
import { normalizeCodigoLC116 } from "../../../lib/listaServicosLC116";
import { parsePfx, cnpjRaizMatches, clearAgentCache } from "./cert";
import { NfseError } from "./errors";
import type { NfseAtividadeRow, NfseConfigRow } from "../../types";

// --- config (certificado + dados fiscais) -----------------------------------

export async function getClientConfig(clientId: string): Promise<NfseConfigRow | null> {
  const [row] = await db.select().from(nfseConfig).where(eq(nfseConfig.clientId, clientId));
  return row ?? null;
}

export async function certFileExists(config: NfseConfigRow | null): Promise<boolean> {
  if (!config?.certPath) return false;
  try {
    await fs.promises.access(config.certPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export interface UpsertConfigInput {
  codigoMunicipio?: string | null;
  regimeTributario?: string;
  regimeEspecialTrib?: string | null;
  optanteSimplesNacional?: boolean;
  incentivoFiscal?: boolean;
  ambiente?: string;
  serieDps?: string;
  ativo?: boolean;
  certSenha?: string; // blank = keep current
}

export interface UpsertConfigResult {
  config: NfseConfigRow;
  warnings: string[];
}

// Creates or updates a client's NFS-e config. `certFilePath` (when present) is
// the raw .pfx multer just wrote to disk — this function validates it, encrypts
// it in place and points certPath at it.
export async function upsertClientConfig(
  clientId: string,
  clientCnpj: string,
  input: UpsertConfigInput,
  certFilePath?: string,
): Promise<UpsertConfigResult> {
  const existing = await getClientConfig(clientId);
  const warnings: string[] = [];
  const update: Partial<NfseConfigRow> = { updatedAt: new Date() };

  if (input.codigoMunicipio !== undefined)
    update.codigoMunicipio = input.codigoMunicipio ? input.codigoMunicipio.replace(/\D/g, "").slice(0, 7) : null;
  if (input.regimeTributario !== undefined) update.regimeTributario = input.regimeTributario;
  if (input.regimeEspecialTrib !== undefined) update.regimeEspecialTrib = input.regimeEspecialTrib || null;
  if (input.optanteSimplesNacional !== undefined) update.optanteSimplesNacional = input.optanteSimplesNacional;
  if (input.incentivoFiscal !== undefined) update.incentivoFiscal = input.incentivoFiscal;
  if (input.ambiente !== undefined) update.ambiente = input.ambiente;
  if (input.serieDps !== undefined) update.serieDps = String(input.serieDps).slice(0, 5) || "00001";

  const senhaInformada = typeof input.certSenha === "string" && input.certSenha.length > 0;
  if (senhaInformada) update.certSenha = encryptSecret(input.certSenha!.trim());

  // New certificate file → validate + encrypt in place.
  if (certFilePath) {
    // O certificado A1 (com a chave privada) e a senha só podem ser guardados
    // se a cifra em repouso estiver ligada. Sem SECRETS_KEY, encryptBytes /
    // encryptSecret viram no-op e o .pfx + senha ficariam em texto puro.
    if (!secretsEncryptionEnabled()) {
      await fs.promises.unlink(certFilePath).catch(() => {});
      throw new NfseError(
        "Armazenamento de certificado indisponível: defina a variável SECRETS_KEY no servidor antes de enviar o certificado A1.",
        { status: 400, reason: "secrets_key_missing" },
      );
    }
    const senhaParaAbrir = senhaInformada
      ? input.certSenha!.trim()
      : decryptSecret(existing?.certSenha) || "";
    if (!senhaParaAbrir) {
      await fs.promises.unlink(certFilePath).catch(() => {});
      throw new NfseError("Informe a senha do certificado para validá-lo.", { status: 400, reason: "cert_senha" });
    }

    let raw: Buffer;
    try {
      raw = await fs.promises.readFile(certFilePath);
    } catch {
      throw new NfseError("Falha ao ler o certificado enviado.", { status: 400 });
    }

    let parsed;
    try {
      parsed = parsePfx(raw, senhaParaAbrir);
    } catch (e) {
      await fs.promises.unlink(certFilePath).catch(() => {});
      throw e;
    }

    if (parsed.notAfter.getTime() <= Date.now()) {
      await fs.promises.unlink(certFilePath).catch(() => {});
      throw new NfseError(
        `Certificado vencido em ${parsed.notAfter.toLocaleDateString("pt-BR")}.`,
        { status: 400, reason: "cert_expired" },
      );
    }
    if (parsed.cnpj && !cnpjRaizMatches(parsed.cnpj, clientCnpj)) {
      await fs.promises.unlink(certFilePath).catch(() => {});
      throw new NfseError(
        `O CNPJ do certificado (${formatCnpj(parsed.cnpj)}) não corresponde ao do cliente (${formatCnpj(clientCnpj)}).`,
        { status: 400, reason: "cert_cnpj_mismatch" },
      );
    }
    if (!parsed.cnpj) {
      warnings.push(
        "Não foi possível ler o CNPJ do certificado — confira se é o certificado da empresa do cliente.",
      );
    }

    try {
      await fs.promises.writeFile(certFilePath, encryptBytes(raw));
    } catch (err) {
      throw new NfseError("Falha ao proteger o certificado no servidor.", { status: 500 });
    }

    update.certPath = certFilePath;
    update.certCnpj = parsed.cnpj;
    update.certValidadeAte = parsed.notAfter;

    // Remove the previous cert file when the path changed.
    if (existing?.certPath && existing.certPath !== certFilePath) {
      await fs.promises.unlink(existing.certPath).catch(() => {});
    }
  } else if (senhaInformada && existing?.certPath) {
    // Senha changed without a new file — re-validate against the stored cert.
    try {
      const raw = await fs.promises.readFile(existing.certPath);
      const parsed = parsePfx(decryptBytes(raw), input.certSenha!.trim());
      update.certCnpj = parsed.cnpj;
      update.certValidadeAte = parsed.notAfter;
    } catch (e) {
      throw e instanceof NfseError
        ? e
        : new NfseError("A senha não abre o certificado já cadastrado.", { status: 400, reason: "cert_senha" });
    }
  }

  // Activation guard.
  const willBeActive = input.ativo ?? existing?.ativo ?? false;
  if (input.ativo !== undefined) update.ativo = input.ativo;
  if (willBeActive) {
    const certOk = Boolean(update.certPath || existing?.certPath);
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(nfseAtividades)
      .where(and(eq(nfseAtividades.clientId, clientId), eq(nfseAtividades.ativo, true)));
    if (!certOk || Number(n) === 0) {
      throw new NfseError(
        "Para ativar a emissão, envie o certificado e cadastre ao menos uma atividade ativa.",
        { status: 400, reason: "activation_incomplete" },
      );
    }
  }

  let config: NfseConfigRow;
  if (existing) {
    [config] = await db
      .update(nfseConfig)
      .set(update)
      .where(eq(nfseConfig.clientId, clientId))
      .returning();
  } else {
    const ambienteDefault = update.ambiente
      ? undefined
      : process.env.NFSE_AMBIENTE_DEFAULT === "producao"
        ? "producao"
        : undefined; // schema default = 'homologacao'
    [config] = await db
      .insert(nfseConfig)
      .values({ clientId, ...update, ...(ambienteDefault ? { ambiente: ambienteDefault } : {}) })
      .returning();
  }

  clearAgentCache(clientId);
  return { config, warnings };
}

// --- atividades ------------------------------------------------------------

export async function listAtividades(clientId: string, onlyActive = false): Promise<NfseAtividadeRow[]> {
  const where = onlyActive
    ? and(eq(nfseAtividades.clientId, clientId), eq(nfseAtividades.ativo, true))
    : eq(nfseAtividades.clientId, clientId);
  return db
    .select()
    .from(nfseAtividades)
    .where(where)
    .orderBy(asc(nfseAtividades.ordem), asc(nfseAtividades.createdAt));
}

export async function getAtividade(clientId: string, id: string): Promise<NfseAtividadeRow | null> {
  const [row] = await db
    .select()
    .from(nfseAtividades)
    .where(and(eq(nfseAtividades.id, id), eq(nfseAtividades.clientId, clientId)));
  return row ?? null;
}

export interface AtividadeInput {
  nome: string;
  itemListaServico: string;
  codTributacaoNac?: string | null;
  codTributacaoMun?: string | null;
  cnae?: string | null;
  descricaoPadrao?: string;
  aliquotaIss?: number;
  issRetido?: boolean;
  exigibilidadeIss?: string;
  municipioIncidencia?: string | null;
  retIrrf?: number;
  retPis?: number;
  retCofins?: number;
  retCsll?: number;
  retInss?: number;
  ativo?: boolean;
  ordem?: number;
}

function normalizeAtividade(input: AtividadeInput) {
  return {
    nome: input.nome.trim(),
    itemListaServico: normalizeCodigoLC116(input.itemListaServico),
    codTributacaoNac: input.codTributacaoNac?.replace(/\D/g, "").slice(0, 6) || null,
    codTributacaoMun: input.codTributacaoMun?.trim() || null,
    cnae: input.cnae?.replace(/\D/g, "").slice(0, 7) || null,
    descricaoPadrao: (input.descricaoPadrao ?? "").trim(),
    aliquotaIss: clampPct(input.aliquotaIss),
    issRetido: Boolean(input.issRetido),
    exigibilidadeIss: input.exigibilidadeIss || "1",
    municipioIncidencia: input.municipioIncidencia?.replace(/\D/g, "").slice(0, 7) || null,
    retIrrf: clampPct(input.retIrrf),
    retPis: clampPct(input.retPis),
    retCofins: clampPct(input.retCofins),
    retCsll: clampPct(input.retCsll),
    retInss: clampPct(input.retInss),
    ativo: input.ativo ?? true,
    ordem: Number.isFinite(input.ordem) ? Number(input.ordem) : 0,
  };
}

function clampPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100);
}

export async function createAtividade(clientId: string, input: AtividadeInput): Promise<NfseAtividadeRow> {
  const [row] = await db
    .insert(nfseAtividades)
    .values({ clientId, ...normalizeAtividade(input) })
    .returning();
  return row;
}

export async function updateAtividade(
  clientId: string,
  id: string,
  input: AtividadeInput,
): Promise<NfseAtividadeRow | null> {
  const [row] = await db
    .update(nfseAtividades)
    .set({ ...normalizeAtividade(input), updatedAt: new Date() })
    .where(and(eq(nfseAtividades.id, id), eq(nfseAtividades.clientId, clientId)))
    .returning();
  return row ?? null;
}

export async function deleteAtividade(clientId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(nfseAtividades)
    .where(and(eq(nfseAtividades.id, id), eq(nfseAtividades.clientId, clientId)))
    .returning({ id: nfseAtividades.id });
  return rows.length > 0;
}

// --- admin overview (lista de clientes com status de NFS-e) ------------------

export interface NfseClientOverview {
  clientId: string;
  name: string;
  cnpj: string;
  configured: boolean;
  ativo: boolean;
  ambiente: string | null;
  hasCert: boolean;
  certValidadeAte: Date | null;
  certVencido: boolean;
  codigoMunicipio: string | null;
  atividadesAtivas: number;
  emissoes: number;
}

export async function nfseClientsOverview(): Promise<NfseClientOverview[]> {
  const clientRows = await db
    .select({ id: clients.id, name: clients.name, cnpj: clients.cnpj })
    .from(clients)
    .orderBy(asc(clients.name));

  const configs = await db.select().from(nfseConfig);
  const configByClient = new Map(configs.map((c) => [c.clientId, c]));

  const atvCounts = await db
    .select({ clientId: nfseAtividades.clientId, n: sql<number>`count(*)` })
    .from(nfseAtividades)
    .where(eq(nfseAtividades.ativo, true))
    .groupBy(nfseAtividades.clientId);
  const atvByClient = new Map(atvCounts.map((r) => [r.clientId, Number(r.n)]));

  const emiCounts = await db
    .select({ clientId: nfseEmissoes.clientId, n: sql<number>`count(*)` })
    .from(nfseEmissoes)
    .where(eq(nfseEmissoes.status, "emitida"))
    .groupBy(nfseEmissoes.clientId);
  const emiByClient = new Map(emiCounts.map((r) => [r.clientId, Number(r.n)]));

  const now = Date.now();
  return clientRows.map((c) => {
    const cfg = configByClient.get(c.id) ?? null;
    return {
      clientId: c.id,
      name: c.name,
      cnpj: c.cnpj,
      configured: Boolean(cfg),
      ativo: Boolean(cfg?.ativo),
      ambiente: cfg?.ambiente ?? null,
      hasCert: Boolean(cfg?.certPath),
      certValidadeAte: cfg?.certValidadeAte ?? null,
      certVencido: Boolean(cfg?.certValidadeAte && cfg.certValidadeAte.getTime() <= now),
      codigoMunicipio: cfg?.codigoMunicipio ?? null,
      atividadesAtivas: atvByClient.get(c.id) ?? 0,
      emissoes: emiByClient.get(c.id) ?? 0,
    };
  });
}
