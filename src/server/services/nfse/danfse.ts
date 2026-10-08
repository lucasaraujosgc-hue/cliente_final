import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { nfseEmissoes } from "../../schema";
import { NFSE_PDF_DIR } from "../upload";
import type { NfseEmissaoRow } from "../../types";
import { loadClientCertContext } from "./cert";
import { baixarDanfse } from "./client";
import { renderDanfsePdf } from "./danfseRender";
import { nfseLog } from "./log";
import { NfseError } from "./errors";

// Caminho local do PDF do DANFSe de uma NFS-e.
//
// Fonte primária = o XML da NFS-e que persistimos (services/nfse/danfseRender).
// A API de geração do DANFSe do ADN foi sobrestada em 03/08/2026 (NT-008); ela
// só é tentada como último recurso quando não temos o XML.

async function isReadable(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function cache(chave: string, bytes: Buffer, emissaoId: string): Promise<string> {
  await fs.promises.mkdir(NFSE_PDF_DIR, { recursive: true });
  const dest = path.join(NFSE_PDF_DIR, `danfse_${chave || emissaoId}.pdf`);
  await fs.promises.writeFile(dest, bytes);
  await db
    .update(nfseEmissoes)
    .set({ danfsePdfPath: dest, updatedAt: new Date() })
    .where(eq(nfseEmissoes.id, emissaoId));
  return dest;
}

export async function getDanfsePdfPath(emissao: NfseEmissaoRow): Promise<string> {
  if (emissao.status !== "emitida" && emissao.status !== "cancelada") {
    throw new NfseError("Nota sem DANFSe disponível.", { status: 400 });
  }
  const chave = (emissao.chaveAcesso || "").replace(/[^0-9A-Z]/gi, "").toUpperCase();
  if (chave.length !== 50) throw new NfseError("Nota sem chave de acesso.", { status: 400 });

  // Regenera se o cancelamento aconteceu depois do PDF em cache (marca d'água).
  const cachedFresh =
    emissao.danfsePdfPath &&
    (await isReadable(emissao.danfsePdfPath)) &&
    !(emissao.status === "cancelada" && emissao.canceladaEm &&
      new Date(emissao.canceladaEm) > (await fs.promises.stat(emissao.danfsePdfPath)).mtime);
  if (cachedFresh) return emissao.danfsePdfPath!;

  // 1) geração local a partir do XML da NFS-e
  if (emissao.xmlNfse) {
    try {
      const bytes = await renderDanfsePdf(emissao.xmlNfse, {
        cancelada: emissao.status === "cancelada",
        substituida: !!emissao.substituiChave,
      });
      nfseLog("info", "danfse.local", { emissaoId: emissao.id, chave });
      return cache(chave, bytes, emissao.id);
    } catch (e) {
      nfseLog("warn", "danfse.local_falhou", {
        emissaoId: emissao.id,
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 2) último recurso: API do ADN (pode estar sobrestada — NT-008)
  try {
    const cert = await loadClientCertContext(emissao.clientId);
    const ambiente = cert.config.ambiente === "producao" ? "producao" : "homologacao";
    const pdf = await baixarDanfse(cert.agent, ambiente, chave);
    nfseLog("info", "danfse.adn", { emissaoId: emissao.id, chave });
    return cache(chave, pdf, emissao.id);
  } catch (e) {
    if (e instanceof NfseError) throw e;
    throw new NfseError("Não foi possível gerar o DANFSe agora.", { status: 502 });
  }
}
