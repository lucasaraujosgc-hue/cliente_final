import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { nfseEmissoes } from "../../schema";
import type { NfseEmissaoRow } from "../../types";
import { NfseError } from "./errors";

// Read side of the emissões table. The write side (emitir / cancelar) lives in
// services/nfse/emitir.ts once the DPS build + signature land (plano fase 3–4).

export async function listEmissoes(clientId: string, limit = 100): Promise<NfseEmissaoRow[]> {
  return db
    .select()
    .from(nfseEmissoes)
    .where(eq(nfseEmissoes.clientId, clientId))
    .orderBy(desc(nfseEmissoes.createdAt))
    .limit(limit);
}

export async function getEmissao(clientId: string, id: string): Promise<NfseEmissaoRow | null> {
  const [row] = await db
    .select()
    .from(nfseEmissoes)
    .where(and(eq(nfseEmissoes.id, id), eq(nfseEmissoes.clientId, clientId)));
  return row ?? null;
}

export async function listAllEmissoes(limit = 200): Promise<NfseEmissaoRow[]> {
  return db.select().from(nfseEmissoes).orderBy(desc(nfseEmissoes.createdAt)).limit(limit);
}

// Admin: qualquer emissão por id (sem filtro de cliente — o contador vê todas).
export async function getEmissaoById(id: string): Promise<NfseEmissaoRow | null> {
  const [row] = await db.select().from(nfseEmissoes).where(eq(nfseEmissoes.id, id));
  return row ?? null;
}

// Só é permitido apagar tentativas que NUNCA viraram documento fiscal: a Sefin
// recusou ('rejeitada'). Uma NFS-e 'emitida' ou 'cancelada' é documento fiscal
// e não pode ser removida; 'processando' pode ainda virar nota (deixa o
// reconcile resolver — em 24h ele mesmo marca 'rejeitada' se nada confirmou).
const STATUS_DESCARTAVEL = ["rejeitada"];

export async function excluirEmissao(
  id: string,
  opts: { clientId?: string } = {},
): Promise<void> {
  const where = opts.clientId
    ? and(eq(nfseEmissoes.id, id), eq(nfseEmissoes.clientId, opts.clientId))
    : eq(nfseEmissoes.id, id);
  const [row] = await db.select().from(nfseEmissoes).where(where);
  if (!row) throw new NfseError("Emissão não encontrada.", { status: 404 });
  if (!STATUS_DESCARTAVEL.includes(row.status)) {
    throw new NfseError(
      `Só é possível excluir notas rejeitadas. Esta está "${row.status}".`,
      { status: 409, reason: "status_nao_descartavel" },
    );
  }
  await db.delete(nfseEmissoes).where(eq(nfseEmissoes.id, row.id));
}

export async function excluirEmissoesDescartaveis(clientId: string): Promise<number> {
  const rows = await db
    .delete(nfseEmissoes)
    .where(
      and(eq(nfseEmissoes.clientId, clientId), inArray(nfseEmissoes.status, STATUS_DESCARTAVEL)),
    )
    .returning({ id: nfseEmissoes.id });
  return rows.length;
}
