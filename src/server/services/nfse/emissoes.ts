import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { nfseEmissoes } from "../../schema";
import type { NfseEmissaoRow } from "../../types";

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
