import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { nfseConfig, nfseEmissoes } from "../../schema";
import { normalizeInscricao, inscricaoRaizMatches } from "./inscricao";
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
  novas: number; // total de NFS-e novas (prestadas + tomadas)
  novasTomadas: number; // quantas das novas são serviço TOMADO
  atualizadas: number;
  eventos: number;
  ultimoNsu: number;
  lotes: number;
}

// De qual lado o CNPJ do cliente está nesta NFS-e. A distribuição do ADN entrega
// tanto notas em que ele é o prestador quanto notas em que ele é o tomador.
export function papelDoCliente(
  cnpjCliente: string,
  prestadorDoc: string | null,
  tomadorDoc: string | null,
): "prestador" | "tomador" {
  const meu = normalizeInscricao(cnpjCliente);
  const pres = normalizeInscricao(prestadorDoc || "");
  const toma = normalizeInscricao(tomadorDoc || "");
  const bate = (a: string, b: string) => !!a && !!b && (a === b || inscricaoRaizMatches(a, b));
  if (bate(meu, pres)) return "prestador";
  if (bate(meu, toma)) return "tomador";
  return "prestador"; // não deu para casar — trata como prestada (comportamento antigo)
}

async function upsertNfseRecebida(
  clientId: string,
  ambiente: string,
  cnpjCliente: string,
  doc: DistribuicaoDoc,
): Promise<{ resultado: "nova" | "atualizada" | "ignorada"; papel: "prestador" | "tomador" }> {
  const info = parseNfseXml(doc.xml);
  const chave = (doc.chaveAcesso || info.chaveAcesso || "").toUpperCase();
  if (!chave) return { resultado: "ignorada", papel: "prestador" };

  const papel = papelDoCliente(cnpjCliente, info.prestadorDoc, info.tomadorDoc);

  const [existente] = await db
    .select()
    .from(nfseEmissoes)
    .where(and(eq(nfseEmissoes.clientId, clientId), eq(nfseEmissoes.chaveAcesso, chave)));

  if (existente) {
    // Já temos essa nota (emitida por aqui ou já distribuída). Amarra o NSU e
    // completa o XML se faltava. Só reclassifica o papel / partes quando a linha
    // veio da distribuição — uma emissão do sistema é sempre 'prestador'.
    await db
      .update(nfseEmissoes)
      .set({
        nsu: doc.nsu,
        xmlNfse: existente.xmlNfse || doc.xml || null,
        ...(existente.origem === "distribuicao"
          ? {
              papel,
              prestadorDoc: info.prestadorDoc ? normalizeInscricao(info.prestadorDoc) : null,
              prestadorNome: info.prestadorNome,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(nfseEmissoes.id, existente.id));
    return { resultado: "atualizada", papel: existente.origem === "distribuicao" ? papel : "prestador" };
  }

  const vServ = Number(String(info.valorServico || "").replace(",", "."));
  await db.insert(nfseEmissoes).values({
    clientId,
    status: "emitida",
    origem: "distribuicao",
    papel,
    nsu: doc.nsu,
    ambiente,
    competencia: info.competencia,
    valorServicos: Number.isFinite(vServ) ? Math.round(vServ * 100) : null,
    descricao: info.descServico,
    prestadorDoc: info.prestadorDoc ? normalizeInscricao(info.prestadorDoc) : null,
    prestadorNome: info.prestadorNome,
    tomadorDoc: info.tomadorDoc ? normalizeInscricao(info.tomadorDoc) : null,
    tomadorNome: info.tomadorNome,
    numeroNota: info.numeroNota,
    serieDps: info.serieDps,
    chaveAcesso: chave,
    dataEmissao: info.dhProc ? new Date(info.dhProc) : doc.dataHoraGeracao ? new Date(doc.dataHoraGeracao) : null,
    xmlNfse: doc.xml || null,
  });
  return { resultado: "nova", papel };
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
  opts: { maxLotes?: number; reiniciar?: boolean } = {},
): Promise<SincronizacaoResultado> {
  const maxLotes = Math.min(Math.max(opts.maxLotes ?? 20, 1), 50);

  const [config] = await db.select().from(nfseConfig).where(eq(nfseConfig.clientId, clientId));
  if (!config) throw new NfseError("Emissão de NFS-e não configurada para este cliente.", { status: 400 });

  const cert = await loadClientCertContext(clientId);
  const ambiente = (cert.config.ambiente === "producao" ? "producao" : "homologacao") as Ambiente;
  const cnpj = normalizeInscricao(cert.config.certCnpj || "");
  if (!cnpj) throw new NfseError("Não foi possível identificar o CNPJ do certificado.", { status: 400 });

  // reiniciar=true varre desde o NSU 0 (diagnóstico / troca de ambiente).
  let nsu = opts.reiniciar ? 0 : (config.ultimoNsu ?? 0);
  const res: SincronizacaoResultado = {
    novas: 0,
    novasTomadas: 0,
    atualizadas: 0,
    eventos: 0,
    ultimoNsu: nsu,
    lotes: 0,
  };

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
          const r = await upsertNfseRecebida(clientId, ambiente, cnpj, doc);
          if (r.resultado === "nova") {
            res.novas++;
            if (r.papel === "tomador") res.novasTomadas++;
          } else if (r.resultado === "atualizada") res.atualizadas++;
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
