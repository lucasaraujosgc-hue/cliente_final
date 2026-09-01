import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "../../db";
import { nfseEmissoes } from "../../schema";
import type { NfseEmissaoRow } from "../../types";
import { loadClientCertContext } from "./cert";
import { consultarNfse, consultarDps, headDps, type Ambiente } from "./client";
import { parseNfseXml } from "./nfseXml";
import { isChaveAcesso } from "./inscricao";
import { nfseLog } from "./log";
import { NfseError } from "./errors";

// Reconciliação de emissões em 'processando'.
//
// Uma emissão fica 'processando' quando o POST /nfse não deu para julgar
// (timeout, erro de rede, HTTP 500 do Sefin, ou 201 sem a NFS-e no corpo). A
// nota PODE ter sido gerada no Sefin. Aqui consultamos GET/HEAD /dps/{id} e
// GET /nfse/{chave} para promover a linha a 'emitida' ou 'rejeitada' — nunca
// reenviamos a DPS.

// Após este prazo sem a NFS-e aparecer no Sefin, tratamos como rejeitada.
const GIVE_UP_MS = 24 * 60 * 60 * 1000;

function nfseRowFromXml(xml: string): Partial<NfseEmissaoRow> {
  const info = parseNfseXml(xml);
  return {
    chaveAcesso: info.chaveAcesso,
    numeroNota: info.numeroNota,
    xmlNfse: xml,
  };
}

export async function reconcileEmissao(
  clientId: string,
  emissaoId: string,
): Promise<NfseEmissaoRow> {
  const [row] = await db
    .select()
    .from(nfseEmissoes)
    .where(and(eq(nfseEmissoes.id, emissaoId), eq(nfseEmissoes.clientId, clientId)));
  if (!row) throw new NfseError("Emissão não encontrada.", { status: 404 });
  if (row.status !== "processando") return row;

  const cert = await loadClientCertContext(clientId);
  const ambiente = (cert.config.ambiente === "producao" ? "producao" : "homologacao") as Ambiente;

  let chave = (row.chaveAcesso || "").toUpperCase();
  try {
    if (!isChaveAcesso(chave) && row.idDps) {
      const exists = await headDps(cert.agent, ambiente, row.idDps).catch(() => false);
      if (exists) {
        chave = (await consultarDps(cert.agent, ambiente, row.idDps)) || "";
      }
    }

    if (isChaveAcesso(chave)) {
      const nfse = await consultarNfse(cert.agent, ambiente, chave);
      if (nfse && nfse.nfseXml) {
        const patch = nfseRowFromXml(nfse.nfseXml);
        const [updated] = await db
          .update(nfseEmissoes)
          .set({
            status: "emitida",
            ...patch,
            chaveAcesso: patch.chaveAcesso || chave,
            syncTentativas: (row.syncTentativas ?? 0) + 1,
            erroMsg: null,
            rejeicaoMotivo: null,
            updatedAt: new Date(),
          })
          .where(eq(nfseEmissoes.id, row.id))
          .returning();
        nfseLog("info", "reconcile.emitida", { emissaoId: row.id, ambiente, chave });
        return updated;
      }
    }
  } catch (e) {
    nfseLog("warn", "reconcile.erro", {
      emissaoId: row.id,
      ambiente,
      msg: e instanceof Error ? e.message : String(e),
    });
  }

  const age = Date.now() - new Date(row.createdAt).getTime();
  const tentativas = (row.syncTentativas ?? 0) + 1;
  if (age > GIVE_UP_MS) {
    const [updated] = await db
      .update(nfseEmissoes)
      .set({
        status: "rejeitada",
        rejeicaoMotivo:
          row.rejeicaoMotivo ||
          "O Sefin Nacional não confirmou a geração da NFS-e dentro do prazo. Verifique manualmente antes de reemitir.",
        syncTentativas: tentativas,
        updatedAt: new Date(),
      })
      .where(eq(nfseEmissoes.id, row.id))
      .returning();
    nfseLog("warn", "reconcile.desistencia", { emissaoId: row.id, ambiente, ageMs: age });
    return updated;
  }

  const [updated] = await db
    .update(nfseEmissoes)
    .set({ syncTentativas: tentativas, updatedAt: new Date() })
    .where(eq(nfseEmissoes.id, row.id))
    .returning();
  return updated;
}

// Emissões 'processando' recentes para este cliente — usadas na dedupe do
// emitir.ts (evita gerar uma 2ª NFS-e quando o usuário reenvia após timeout).
export async function pendingEmissoes(
  clientId: string,
  sinceMs = 15 * 60 * 1000,
): Promise<NfseEmissaoRow[]> {
  return db
    .select()
    .from(nfseEmissoes)
    .where(
      and(
        eq(nfseEmissoes.clientId, clientId),
        inArray(nfseEmissoes.status, ["processando"]),
        gt(nfseEmissoes.createdAt, new Date(Date.now() - sinceMs)),
      ),
    );
}
