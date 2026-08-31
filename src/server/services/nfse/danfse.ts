import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { nfseEmissoes } from "../../schema";
import { NFSE_PDF_DIR } from "../upload";
import type { NfseEmissaoRow } from "../../types";
import { loadClientCertContext } from "./cert";
import { baixarDanfse } from "./client";
import { NfseError } from "./errors";

// Returns the local path of the DANFSE PDF for an emitted NFS-e, fetching it
// from the ADN and caching it on disk on first access. Mirrors the guia-PDF
// caching in client.routes.ts (GUIAS_PDF_DIR).

async function isReadable(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function getDanfsePdfPath(emissao: NfseEmissaoRow): Promise<string> {
  if (emissao.status !== "emitida" && emissao.status !== "cancelada") {
    throw new NfseError("Nota sem DANFSE disponível.", { status: 400 });
  }
  const chave = (emissao.chaveAcesso || "").replace(/\D/g, "");
  if (chave.length !== 50) throw new NfseError("Nota sem chave de acesso.", { status: 400 });

  if (emissao.danfsePdfPath && (await isReadable(emissao.danfsePdfPath))) {
    return emissao.danfsePdfPath;
  }

  const cert = await loadClientCertContext(emissao.clientId);
  const ambiente = cert.config.ambiente === "producao" ? "producao" : "homologacao";
  const pdf = await baixarDanfse(cert.agent, ambiente, chave);

  await fs.promises.mkdir(NFSE_PDF_DIR, { recursive: true });
  const dest = path.join(NFSE_PDF_DIR, `danfse_${chave}.pdf`);
  await fs.promises.writeFile(dest, pdf);

  await db
    .update(nfseEmissoes)
    .set({ danfsePdfPath: dest, updatedAt: new Date() })
    .where(eq(nfseEmissoes.id, emissao.id));

  return dest;
}
