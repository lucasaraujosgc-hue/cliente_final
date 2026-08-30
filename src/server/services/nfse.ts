import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { nfseEmissoes } from "../schema";

// NFS-e (Nota Fiscal de Serviço eletrônica).
//
// The emitter is NOT implemented. This module is the isolated scaffold so the
// future integration (municipal webservice, or the Nota Fiscal de Serviço
// nacional) plugs in here without touching the rest of the app. Nothing here
// makes an external call.

// When emission is expected to go live.
export const NFSE_AVAILABLE_FROM = "2026-11-01";

export class NotImplementedError extends Error {
  status = 501;
  constructor(message = "Emissão de NFS-e ainda não disponível. Prevista para novembro/2026.") {
    super(message);
    this.name = "NotImplementedError";
  }
}

export function nfseStatus() {
  return {
    enabled: false,
    availableFrom: NFSE_AVAILABLE_FROM,
    message:
      "A emissão de Nota de Serviço estará disponível a partir de novembro/2026.",
  };
}

export async function listEmissoes(clientId: string) {
  return db
    .select()
    .from(nfseEmissoes)
    .where(eq(nfseEmissoes.clientId, clientId))
    .orderBy(desc(nfseEmissoes.createdAt));
}

export async function getEmissao(clientId: string, id: string) {
  const [row] = await db
    .select()
    .from(nfseEmissoes)
    .where(and(eq(nfseEmissoes.id, id), eq(nfseEmissoes.clientId, clientId)));
  return row ?? null;
}

// Placeholder. The real implementation will:
//   1. validate the service data against the municipality's rules,
//   2. build + sign the RPS/DPS,
//   3. call the provider webservice,
//   4. persist status / numeroNota / codigoVerificacao / xml / pdfUrl.
export async function createEmissao(): Promise<never> {
  throw new NotImplementedError();
}
