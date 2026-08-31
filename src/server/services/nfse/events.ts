import { create } from "xmlbuilder2";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { clients, nfseEmissoes } from "../../schema";
import { normalizeCnpj } from "../../../lib/cnpj";
import type { NfseEmissaoRow } from "../../types";
import { loadClientCertContext } from "./cert";
import { signPedRegEvento } from "./sign";
import { registrarEvento, type Ambiente } from "./client";
import { NFSE_NS, DPS_VERSAO, VER_APLIC } from "./dps";
import { NfseError } from "./errors";

// Cancelamento de NFS-e — evento e101101 (Pedido de Registro de Evento).
// Schema: pedRegEvento_v1.01 / TCInfPedReg + TE101101.

const COD_EVENTO_CANCELAMENTO = "101101";

function dhEventoUTC(d: Date): string {
  const b = new Date(d.getTime() - 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${b.getUTCFullYear()}-${p(b.getUTCMonth() + 1)}-${p(b.getUTCDate())}T${p(b.getUTCHours())}:${p(b.getUTCMinutes())}:${p(b.getUTCSeconds())}-03:00`;
}

export async function cancelarNfse(
  clientId: string,
  emissaoId: string,
  motivo: string,
): Promise<NfseEmissaoRow> {
  const [emissao] = await db
    .select()
    .from(nfseEmissoes)
    .where(and(eq(nfseEmissoes.id, emissaoId), eq(nfseEmissoes.clientId, clientId)));
  if (!emissao) throw new NfseError("Nota não encontrada.", { status: 404 });
  if (emissao.status === "cancelada") throw new NfseError("Nota já cancelada.", { status: 400 });
  if (emissao.status !== "emitida" || !emissao.chaveAcesso) {
    throw new NfseError("Só é possível cancelar uma nota emitida com sucesso.", { status: 400 });
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  const cert = await loadClientCertContext(clientId);
  const ambiente = (cert.config.ambiente === "producao" ? "producao" : "homologacao") as Ambiente;
  const chave = emissao.chaveAcesso.replace(/\D/g, "");
  const cnpjAutor = normalizeCnpj(client?.cnpj || cert.parsed.cnpj || "");
  const xMotivo = motivo.trim().slice(0, 255).padEnd(15, " ");
  const idPedReg = `PRE${chave}${COD_EVENTO_CANCELAMENTO}`;

  const doc = create({ version: "1.0", encoding: "UTF-8" }).ele(NFSE_NS, "pedRegEvento", {
    versao: DPS_VERSAO,
  });
  const inf = doc.ele("infPedReg", { Id: idPedReg });
  inf.ele("tpAmb").txt(ambiente === "producao" ? "1" : "2");
  inf.ele("verAplic").txt(VER_APLIC);
  inf.ele("dhEvento").txt(dhEventoUTC(new Date()));
  inf.ele("CNPJAutor").txt(cnpjAutor);
  inf.ele("chNFSe").txt(chave);
  const ev = inf.ele("e101101");
  ev.ele("xDesc").txt("Cancelamento de NFS-e");
  ev.ele("cMotivo").txt("1"); // 1 = erro na emissão
  ev.ele("xMotivo").txt(xMotivo);

  const xml = doc.end({ prettyPrint: false, headless: false });
  const assinado = signPedRegEvento(xml, idPedReg, cert.parsed.keyPem, cert.parsed.certPem);

  await registrarEvento(cert.agent, ambiente, chave, assinado);

  const [row] = await db
    .update(nfseEmissoes)
    .set({
      status: "cancelada",
      canceladaEm: new Date(),
      cancelamentoMotivo: motivo.trim().slice(0, 255),
      updatedAt: new Date(),
    })
    .where(eq(nfseEmissoes.id, emissaoId))
    .returning();
  return row;
}
