import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { nfseConfig, nfseEmissoes } from "../../schema";
import { normalizeInscricao } from "./inscricao";
import { loadClientCertContext } from "./cert";
import { contribuintesBase, distribuirDFe, type Ambiente, type DistribuicaoDoc } from "./client";
import { parseNfseXml } from "./nfseXml";
import { nfseLog } from "./log";
import { NfseError } from "./errors";

// Distribuição de DF-e (ADN Contribuinte, GET /DFe/{NSU}).
//
// Busca no portal nacional as NFS-e do prestador que NÃO foram emitidas por
// aqui — geradas pela prefeitura, por outro sistema, ou antes deste. Reflete
// tudo em nfse_emissoes com origem='distribuicao'. Também aplica eventos de
// cancelamento vindos do ADN.
//
// Modelo NSU: guardamos o último NSU consumido em nfse_config.ultimo_nsu e
// pedimos os documentos com NSU maior. NSU 0 = desde o início.

// Eventos que efetivamente cancelam a NFS-e.
const EVENTOS_CANCELAMENTO = new Set([
  "CANCELAMENTO",
  "CANCELAMENTO_POR_SUBSTITUICAO",
  "CANCELAMENTO_DEFERIDO_ANALISE_FISCAL",
  "CANCELAMENTO_POR_OFICIO",
]);

export interface SincronizacaoResultado {
  novas: number;
  atualizadas: number;
  eventos: number;
  ultimoNsu: number;
  lotes: number;
}

async function upsertNfseRecebida(
  clientId: string,
  ambiente: string,
  doc: DistribuicaoDoc,
): Promise<"nova" | "atualizada" | "ignorada"> {
  const info = parseNfseXml(doc.xml);
  const chave = (doc.chaveAcesso || info.chaveAcesso || "").toUpperCase();
  if (!chave) return "ignorada";

  const [existente] = await db
    .select()
    .from(nfseEmissoes)
    .where(and(eq(nfseEmissoes.clientId, clientId), eq(nfseEmissoes.chaveAcesso, chave)));

  if (existente) {
    // Já temos essa nota (emitida por aqui ou já distribuída). Só amarra o NSU
    // e completa o XML da NFS-e se faltava.
    await db
      .update(nfseEmissoes)
      .set({
        nsu: doc.nsu,
        xmlNfse: existente.xmlNfse || doc.xml || null,
        updatedAt: new Date(),
      })
      .where(eq(nfseEmissoes.id, existente.id));
    return "atualizada";
  }

  const vServ = Number(String(info.valorServico || "").replace(",", "."));
  await db.insert(nfseEmissoes).values({
    clientId,
    status: "emitida",
    origem: "distribuicao",
    nsu: doc.nsu,
    ambiente,
    competencia: info.competencia,
    valorServicos: Number.isFinite(vServ) ? Math.round(vServ * 100) : null,
    descricao: info.descServico,
    tomadorDoc: info.tomadorDoc ? normalizeInscricao(info.tomadorDoc) : null,
    tomadorNome: info.tomadorNome,
    numeroNota: info.numeroNota,
    serieDps: info.serieDps,
    chaveAcesso: chave,
    dataEmissao: info.dhProc ? new Date(info.dhProc) : doc.dataHoraGeracao ? new Date(doc.dataHoraGeracao) : null,
    xmlNfse: doc.xml || null,
  });
  return "nova";
}

async function aplicarEvento(clientId: string, doc: DistribuicaoDoc): Promise<boolean> {
  const chave = (doc.chaveAcesso || "").toUpperCase();
  if (!chave || !doc.tipoEvento || !EVENTOS_CANCELAMENTO.has(doc.tipoEvento)) return false;
  const [row] = await db
    .select()
    .from(nfseEmissoes)
    .where(and(eq(nfseEmissoes.clientId, clientId), eq(nfseEmissoes.chaveAcesso, chave)));
  if (!row || row.status === "cancelada") return false;
  await db
    .update(nfseEmissoes)
    .set({
      status: "cancelada",
      canceladaEm: doc.dataHoraGeracao ? new Date(doc.dataHoraGeracao) : new Date(),
      cancelamentoMotivo: row.cancelamentoMotivo || `Evento ${doc.tipoEvento} recebido do portal nacional`,
      nsu: doc.nsu,
      updatedAt: new Date(),
    })
    .where(eq(nfseEmissoes.id, row.id));
  return true;
}

export async function sincronizarDistribuicao(
  clientId: string,
  opts: { maxLotes?: number } = {},
): Promise<SincronizacaoResultado> {
  const maxLotes = Math.min(Math.max(opts.maxLotes ?? 20, 1), 50);

  const [config] = await db.select().from(nfseConfig).where(eq(nfseConfig.clientId, clientId));
  if (!config) throw new NfseError("Emissão de NFS-e não configurada para este cliente.", { status: 400 });

  const cert = await loadClientCertContext(clientId);
  const ambiente = (cert.config.ambiente === "producao" ? "producao" : "homologacao") as Ambiente;
  const cnpj = normalizeInscricao(cert.config.certCnpj || "");
  if (!cnpj) throw new NfseError("Não foi possível identificar o CNPJ do certificado.", { status: 400 });

  let nsu = config.ultimoNsu ?? 0;
  const res: SincronizacaoResultado = { novas: 0, atualizadas: 0, eventos: 0, ultimoNsu: nsu, lotes: 0 };

  nfseLog("info", "distribuicao.inicio", {
    clientId,
    ambiente,
    cnpj,
    nsu,
    base: contribuintesBase(ambiente),
  });

  for (let i = 0; i < maxLotes; i++) {
    const lote = await distribuirDFe(cert.agent, ambiente, cnpj, nsu);
    res.lotes++;

    if (lote.status === "REJEICAO") {
      const motivo = lote.erros[0]?.mensagem || "Distribuição rejeitada pelo ADN.";
      nfseLog("warn", "distribuicao.rejeicao", { clientId, nsu, motivo });
      throw new NfseError(motivo, { status: 502, reason: "distribuicao_rejeitada" });
    }

    for (const doc of lote.docs) {
      try {
        if (doc.tipoDocumento === "NFSE" && doc.xml) {
          const r = await upsertNfseRecebida(clientId, ambiente, doc);
          if (r === "nova") res.novas++;
          else if (r === "atualizada") res.atualizadas++;
        } else if (doc.tipoDocumento === "EVENTO") {
          if (await aplicarEvento(clientId, doc)) res.eventos++;
        }
      } catch (e) {
        nfseLog("warn", "distribuicao.doc_erro", {
          clientId,
          nsu: doc.nsu,
          tipo: doc.tipoDocumento,
          msg: e instanceof Error ? e.message : String(e),
        });
      }
    }

    nsu = lote.ultimoNsu;
    res.ultimoNsu = nsu;
    await db
      .update(nfseConfig)
      .set({ ultimoNsu: nsu, updatedAt: new Date() })
      .where(eq(nfseConfig.clientId, clientId));

    if (lote.status === "NENHUM_DOCUMENTO_LOCALIZADO" || lote.docs.length === 0) break;
  }

  nfseLog("info", "distribuicao.ok", {
    clientId,
    ambiente,
    ...res,
  });
  return res;
}
