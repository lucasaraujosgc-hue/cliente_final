import { Express } from "express";
import fs from "fs";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { clients } from "../schema";
import { verifyClientAuth, verifyAccountantAuth, verifyAnyAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { nfseEmitLimiter, nfseLookupLimiter } from "../middleware/rateLimit";
import { getClientId } from "../types";
import { isUuid } from "../services/serpro";
import { uploadNfseCert } from "../services/upload";
import { logAudit } from "../services/audit";
import { sendDiskFile } from "../services/files";
import { formatCnpj } from "../../lib/cnpj";
import { estadoLote, estadoLoteAtividades, rodarLoteAtividades, rodarLoteProcuracao } from "../services/nfse/lote";
import { sugerirAtividades } from "../services/nfse/sugestao";
import { nomeArquivoNfse } from "../../lib/filtroNotas";
import { LISTA_SERVICOS_LC116 } from "../../lib/listaServicosLC116";
import {
  nfseConfigSchema,
  nfseAtividadeSchema,
  nfseCnpjLookupSchema,
  nfseCepLookupSchema,
  nfseEmitSchema,
  nfseCancelSchema,
  nfseLoteSchema,
} from "../schemas/validation";
import {
  nfseStatusForClient,
  listEmissoes,
  listEmissoesTomadas,
  getEmissao,
  getEmissaoById,
  listAllEmissoes,
  getClientConfig,
  certFileExists,
  upsertClientConfig,
  listAtividades,
  createAtividade,
  updateAtividade,
  deleteAtividade,
  nfseClientsOverview,
  loadClientCertContext,
  infoCertEscritorio,
  lookupCnpj,
  lookupCep,
  emitirNfse,
  reconcileEmissao,
  sincronizarDistribuicao,
  excluirEmissao,
  excluirEmissoesDescartaveis,
  cancelarNfse,
  getDanfsePdfPath,
  getConvenio,
  nfseLog,
  DPS_VERSAO,
  sefinBase,
  NfseError,
} from "../services/nfse";
import {
  nfseConfigDTO,
  nfseAtividadeAdminDTO,
  nfseAtividadeClientDTO,
  nfseEmissaoListDTO,
  nfseEmissaoDetailDTO,
} from "../dto/nfse";

// Turns a thrown NfseError into a structured JSON response so the UI can show a
// rejection code/motivo. Anything else propagates to the central handler.
function sendNfseError(res: any, e: unknown): boolean {
  if (e instanceof NfseError) {
    // 'processando' = a DPS foi enviada mas o Sefin ainda não confirmou; não é
    // erro do usuário. O front trata como "aguardando" e não deve reemitir.
    if (e.reason === "processando") {
      res.status(e.status === 409 ? 409 : 202).json({
        ok: false,
        processando: true,
        id: e.codigo ?? null,
        error: e.message,
        motivo: e.message,
      });
      return true;
    }
    res.status(e.status).json({ error: e.message, codigo: e.codigo ?? null, motivo: e.motivo ?? null });
    return true;
  }
  return false;
}

async function loadClientOr404(id: string, res: any) {
  if (!isUuid(id)) {
    res.status(400).json({ error: "ID de cliente inválido." });
    return null;
  }
  const [client] = await db.select().from(clients).where(eq(clients.id, id));
  if (!client) {
    res.status(404).json({ error: "Cliente não encontrado." });
    return null;
  }
  return client;
}

// Coerce FormData "" → undefined so "campo em branco = manter" works.
// Emite a NFS-e de `clientId` com o corpo já validado (nfseEmitSchema) e
// registra na auditoria. Usado pelo app do cliente e pelo contador.
async function emitirPeloCorpo(req: any, clientId: string, b: any, porContador: boolean) {
  const emissao = await emitirNfse(clientId, {
    atividadeId: b.atividadeId,
    // Só CPF/CNPJ e nome — endereço/telefone/e-mail que versões antigas do app
    // ainda mandem são descartados pelo schema.
    tomador: b.tomador?.doc ? { doc: b.tomador.doc, nome: b.tomador.nome } : null,
    descricao: b.descricao,
    valor: b.valor,
    competencia: b.competencia || undefined,
    obra: b.obra ?? null,
    evento: b.evento ?? null,
    localPrestacaoCep: b.localPrestacaoCep || null,
  });
  await logAudit(req, "nfse.emissao", {
    targetType: "nfse_emissao",
    targetId: emissao.id,
    summary: `NFS-e ${emissao.status}${emissao.numeroNota ? ` nº ${emissao.numeroNota}` : ""}${porContador ? " (emitida pelo contador)" : ""}`,
    metadata: {
      clientId,
      status: emissao.status,
      ambiente: emissao.ambiente,
      idDps: emissao.idDps,
      chaveAcesso: emissao.chaveAcesso,
      porContador,
    },
  });
  return {
    ok: emissao.status === "emitida",
    processando: emissao.status === "processando",
    id: emissao.id,
    status: emissao.status,
    chaveAcesso: emissao.chaveAcesso,
    numeroNota: emissao.numeroNota,
  };
}

// "NFS-e 43 - TOMADOR - 02-11-2026.pdf" — o mesmo nome que o app usa.
function nomePdf(e: { numeroNota?: string | null; papel?: string | null; tomadorNome?: string | null; tomadorDoc?: string | null; prestadorNome?: string | null; dataEmissao?: Date | string | null; createdAt?: Date | string | null }) {
  const iso = (v: Date | string | null | undefined) => (v instanceof Date ? v.toISOString() : v ?? null);
  return nomeArquivoNfse({ ...e, dataEmissao: iso(e.dataEmissao), createdAt: iso(e.createdAt) });
}

function blank(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

export function registerNfseRoutes(app: Express) {
  // Uma linha no boot pra confirmar, pelo log do serviço, qual configuração de
  // NFS-e está no ar.
  nfseLog("info", "boot", {
    dpsVersao: DPS_VERSAO,
    verAplic: process.env.NFSE_VER_APLIC || "portal-virgula-1",
    ibsCbsEnviar: process.env.NFSE_IBSCBS_ENVIAR === "1",
    nfseDebug: process.env.NFSE_DEBUG === "1",
    sefinProd: sefinBase("producao"),
    sefinRestrita: sefinBase("homologacao"),
  });

  // ---- Reference data (both audiences) ------------------------------------
  app.get("/api/nfse/lista-servicos", verifyAnyAuth, (_req, res) => {
    res.json({ servicos: LISTA_SERVICOS_LC116 });
  });

  // ======================================================================
  //  Client-facing
  // ======================================================================

  app.get("/api/nfse", verifyClientAuth, async (req, res) => {
    res.json(await nfseStatusForClient(getClientId(req)));
  });

  app.get("/api/nfse/atividades", verifyClientAuth, async (req, res) => {
    const rows = await listAtividades(getClientId(req), true);
    res.json({ atividades: rows.map(nfseAtividadeClientDTO) });
  });

  app.get("/api/nfse/emissoes", verifyClientAuth, async (req, res) => {
    const rows = await listEmissoes(getClientId(req));
    res.json({ emissoes: rows.map(nfseEmissaoListDTO) });
  });

  // NFS-e de serviço TOMADO (o cliente é o tomador) — trazidas da distribuição
  // do portal nacional. Somente leitura.
  app.get("/api/nfse/tomados", verifyClientAuth, async (req, res) => {
    const rows = await listEmissoesTomadas(getClientId(req));
    res.json({ tomados: rows.map(nfseEmissaoListDTO) });
  });

  app.get("/api/nfse/emissoes/:id", verifyClientAuth, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
    const emissao = await getEmissao(getClientId(req), req.params.id);
    if (!emissao) return res.status(404).json({ error: "Emissão não encontrada." });
    res.json({ emissao: nfseEmissaoDetailDTO(emissao) });
  });

  app.post(
    "/api/nfse/lookup-cnpj",
    verifyClientAuth,
    nfseLookupLimiter,
    validateBody(nfseCnpjLookupSchema),
    async (req, res) => {
      // The emitter must be enabled for this client before it can look up tomadores.
      const status = await nfseStatusForClient(getClientId(req));
      if (!status.enabled) return res.status(403).json({ error: "Emissão de NFS-e não habilitada." });
      try {
        res.json({ tomador: await lookupCnpj(req.body.cnpj) });
      } catch (e) {
        if (sendNfseError(res, e)) return;
        throw e;
      }
    },
  );

  // Endereço do tomador pelo CEP (dá o código IBGE do município que a DPS
  // exige). Usado quando a consulta de CNPJ falha ou vem incompleta.
  app.post(
    "/api/nfse/lookup-cep",
    verifyClientAuth,
    nfseLookupLimiter,
    validateBody(nfseCepLookupSchema),
    async (req, res) => {
      const status = await nfseStatusForClient(getClientId(req));
      if (!status.enabled) return res.status(403).json({ error: "Emissão de NFS-e não habilitada." });
      try {
        res.json({ endereco: await lookupCep(req.body.cep) });
      } catch (e) {
        if (sendNfseError(res, e)) return;
        throw e;
      }
    },
  );

  app.post(
    "/api/nfse/emissoes",
    verifyClientAuth,
    nfseEmitLimiter,
    validateBody(nfseEmitSchema),
    async (req, res) => {
      const clientId = getClientId(req);
      const status = await nfseStatusForClient(clientId);
      if (!status.enabled) {
        return res.status(403).json({ error: "Emissão de NFS-e não habilitada para este cliente." });
      }
      try {
        res.json(await emitirPeloCorpo(req, clientId, req.body, false));
      } catch (e) {
        if (sendNfseError(res, e)) return;
        throw e;
      }
    },
  );

  // Busca no portal nacional (ADN) as NFS-e do prestador que não foram emitidas
  // por aqui — geradas pela prefeitura ou por outro sistema.
  app.post("/api/nfse/sincronizar-dfe", verifyClientAuth, nfseLookupLimiter, async (req, res) => {
    const status = await nfseStatusForClient(getClientId(req));
    if (!status.enabled) return res.status(403).json({ error: "Emissão de NFS-e não habilitada." });
    try {
      const r = await sincronizarDistribuicao(getClientId(req));
      res.json({ ok: true, ...r });
    } catch (e) {
      if (sendNfseError(res, e)) return;
      // Erro fora do contrato NfseError (DB, migração faltando, bug) — registra o
      // motivo cru no log do serviço antes de virar 500 genérico.
      nfseLog("error", "distribuicao.falha", {
        clientId: getClientId(req),
        msg: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack?.split("\n").slice(0, 4).join(" | ") : undefined,
      });
      res.status(502).json({ error: e instanceof Error ? e.message : "Falha ao sincronizar com o portal nacional." });
    }
  });

  // Reconciliação manual de uma emissão em 'processando' (consulta GET /dps +
  // GET /nfse no Sefin; nunca reenvia a DPS).
  app.post("/api/nfse/emissoes/:id/sincronizar", verifyClientAuth, nfseLookupLimiter, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
    try {
      const row = await reconcileEmissao(getClientId(req), req.params.id);
      res.json({
        ok: true,
        id: row.id,
        status: row.status,
        chaveAcesso: row.chaveAcesso,
        numeroNota: row.numeroNota,
        rejeicaoMotivo: row.rejeicaoMotivo,
      });
    } catch (e) {
      if (sendNfseError(res, e)) return;
      throw e;
    }
  });

  app.post(
    "/api/nfse/emissoes/:id/cancelar",
    verifyClientAuth,
    nfseEmitLimiter,
    validateBody(nfseCancelSchema),
    async (req, res) => {
      if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
      try {
        const row = await cancelarNfse(getClientId(req), req.params.id, req.body.motivo);
        await logAudit(req, "nfse.cancelamento", {
          targetType: "nfse_emissao",
          targetId: row.id,
          summary: `NFS-e nº ${row.numeroNota || row.id} cancelada`,
          metadata: { chaveAcesso: row.chaveAcesso, motivo: req.body.motivo },
        });
        res.json({ ok: true, status: row.status, canceladaEm: row.canceladaEm });
      } catch (e) {
        if (sendNfseError(res, e)) return;
        throw e;
      }
    },
  );

  // Descarta uma tentativa rejeitada (nunca virou documento fiscal). O serviço
  // recusa qualquer status != 'rejeitada'.
  app.delete("/api/nfse/emissoes/:id", verifyClientAuth, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
    try {
      await excluirEmissao(req.params.id, { clientId: getClientId(req) });
      res.json({ ok: true });
    } catch (e) {
      if (sendNfseError(res, e)) return;
      throw e;
    }
  });

  // Limpa de uma vez todas as rejeitadas do cliente.
  app.post("/api/nfse/emissoes/limpar-rejeitadas", verifyClientAuth, async (req, res) => {
    const n = await excluirEmissoesDescartaveis(getClientId(req));
    res.json({ ok: true, removidas: n });
  });

  app.get("/api/nfse/emissoes/:id/danfse", verifyClientAuth, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
    const emissao = await getEmissao(getClientId(req), req.params.id);
    if (!emissao) return res.status(404).json({ error: "Emissão não encontrada." });
    try {
      const pdfPath = await getDanfsePdfPath(emissao);
      const download = req.query.download === "1";
      await sendDiskFile(res, pdfPath, {
        disposition: download ? "attachment" : "inline",
        downloadName: `${nomePdf(emissao)}.pdf`,
      });
    } catch (e) {
      if (sendNfseError(res, e)) return;
      throw e;
    }
  });

  // ======================================================================
  //  Accountant-facing  (/api/nfse/admin/*)
  // ======================================================================

  app.get("/api/nfse/admin/clients", verifyAccountantAuth, async (_req, res) => {
    const rows = await nfseClientsOverview();
    res.json({
      clients: rows.map((r) => ({ ...r, cnpjFormatado: formatCnpj(r.cnpj) })),
    });
  });

  app.get("/api/nfse/admin/emissoes", verifyAccountantAuth, async (_req, res) => {
    const rows = await listAllEmissoes();
    res.json({
      emissoes: rows.map((e) => ({ ...nfseEmissaoDetailDTO(e), clientId: e.clientId })),
    });
  });

  // ---- Contador emite e consulta as notas de um cliente -------------------

  // Notas do cliente (emitidas e recebidas) + o que o assistente de emissão precisa.
  app.get("/api/nfse/admin/clients/:id/notas", verifyAccountantAuth, async (req, res) => {
    const client = await loadClientOr404(req.params.id, res);
    if (!client) return;
    const [emitidas, tomadas, atividades, status] = await Promise.all([
      listEmissoes(client.id),
      listEmissoesTomadas(client.id),
      listAtividades(client.id, true),
      nfseStatusForClient(client.id),
    ]);
    res.json({
      habilitado: status.enabled,
      // sem_config | sem_certificado | inativo | sem_atividade
      motivo: status.enabled ? null : (status.motivo ?? null),
      ambiente: status.ambiente,
      atividades: atividades.map(nfseAtividadeClientDTO),
      emitidas: emitidas.map(nfseEmissaoListDTO),
      tomadas: tomadas.map(nfseEmissaoListDTO),
    });
  });

  app.post(
    "/api/nfse/admin/clients/:id/emissoes",
    verifyAccountantAuth,
    nfseEmitLimiter,
    validateBody(nfseEmitSchema),
    async (req, res) => {
      const client = await loadClientOr404(req.params.id, res);
      if (!client) return;
      const status = await nfseStatusForClient(client.id);
      if (!status.enabled) {
        return res.status(403).json({ error: "Emissão de NFS-e não habilitada para este cliente." });
      }
      try {
        res.json(await emitirPeloCorpo(req, client.id, req.body, true));
      } catch (e) {
        if (sendNfseError(res, e)) return;
        throw e;
      }
    },
  );

  app.post("/api/nfse/admin/lookup-cnpj", verifyAccountantAuth, nfseLookupLimiter, validateBody(nfseCnpjLookupSchema), async (req, res) => {
    try {
      res.json({ tomador: await lookupCnpj(req.body.cnpj) });
    } catch (e) {
      if (sendNfseError(res, e)) return;
      throw e;
    }
  });

  app.post("/api/nfse/admin/lookup-cep", verifyAccountantAuth, nfseLookupLimiter, validateBody(nfseCepLookupSchema), async (req, res) => {
    try {
      res.json({ endereco: await lookupCep(req.body.cep) });
    } catch (e) {
      if (sendNfseError(res, e)) return;
      throw e;
    }
  });

  // Reconcilia uma emissão em 'processando' de qualquer cliente (nunca reenvia).
  app.post("/api/nfse/admin/emissoes/:id/sincronizar", verifyAccountantAuth, nfseLookupLimiter, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
    const emissao = await getEmissaoById(req.params.id);
    if (!emissao) return res.status(404).json({ error: "Emissão não encontrada." });
    try {
      const row = await reconcileEmissao(emissao.clientId, emissao.id);
      res.json({
        ok: true,
        id: row.id,
        status: row.status,
        chaveAcesso: row.chaveAcesso,
        numeroNota: row.numeroNota,
        rejeicaoMotivo: row.rejeicaoMotivo,
      });
    } catch (e) {
      if (sendNfseError(res, e)) return;
      throw e;
    }
  });

  // DANFSE (PDF) de qualquer nota — emitida ou recebida.
  app.get("/api/nfse/admin/emissoes/:id/danfse", verifyAccountantAuth, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
    const emissao = await getEmissaoById(req.params.id);
    if (!emissao) return res.status(404).json({ error: "Emissão não encontrada." });
    try {
      const pdfPath = await getDanfsePdfPath(emissao);
      await sendDiskFile(res, pdfPath, {
        disposition: req.query.download === "1" ? "attachment" : "inline",
        downloadName: `${nomePdf(emissao)}.pdf`,
      });
    } catch (e) {
      if (sendNfseError(res, e)) return;
      throw e;
    }
  });

  // Contador: liga a NFS-e por procuração (sem ligar a emissão) e busca as notas
  // de todos os clientes no portal nacional — o faturamento sai das notas. Em
  // segundo plano; o andamento é lido no GET.
  app.post("/api/nfse/admin/lote/procuracao", verifyAccountantAuth, validateBody(nfseLoteSchema), async (req, res) => {
    if (estadoLote()?.emAndamento) return res.status(409).json({ error: "Já está em andamento.", estado: estadoLote() });
    await logAudit(req, "nfse.lote_procuracao", { summary: "Configurar por procuração e buscar as notas de todos os clientes" });
    res.status(202).json({ estado: await rodarLoteProcuracao() });
  });

  app.get("/api/nfse/admin/lote/procuracao", verifyAccountantAuth, (_req, res) => {
    res.json({ estado: estadoLote() });
  });

  // Sugere as atividades (pelas notas anteriores ou pelo CNAE) — criadas
  // desligadas e marcadas para o contador conferir. Todos (lote) ou um cliente.
  app.post("/api/nfse/admin/lote/atividades", verifyAccountantAuth, validateBody(nfseLoteSchema), async (req, res) => {
    if (estadoLoteAtividades()?.emAndamento) return res.status(409).json({ error: "Já está em andamento.", estado: estadoLoteAtividades() });
    await logAudit(req, "nfse.lote_atividades", { summary: "Sugerir atividades de NFS-e de todos os clientes" });
    res.status(202).json({ estado: await rodarLoteAtividades() });
  });

  app.get("/api/nfse/admin/lote/atividades", verifyAccountantAuth, (_req, res) => {
    res.json({ estado: estadoLoteAtividades() });
  });

  app.post("/api/nfse/admin/clients/:id/atividades/sugerir", verifyAccountantAuth, validateBody(nfseLoteSchema), async (req, res) => {
    const client = await loadClientOr404(req.params.id, res);
    if (!client) return;
    const r = await sugerirAtividades(client.id);
    if (r.criadas.length) {
      await logAudit(req, "nfse.atividades_sugeridas", {
        targetType: "client",
        targetId: client.id,
        summary: `${r.criadas.length} atividade(s) sugerida(s): ${r.criadas.map((c) => c.cTribNac).join(", ")}`,
      });
    }
    res.json(r);
  });

  // Contador: cancela uma NFS-e emitida de qualquer cliente (evento de
  // cancelamento assinado com o certificado do cliente ou do escritório).
  app.post(
    "/api/nfse/admin/emissoes/:id/cancelar",
    verifyAccountantAuth,
    nfseEmitLimiter,
    validateBody(nfseCancelSchema),
    async (req, res) => {
      if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
      const atual = await getEmissaoById(req.params.id);
      if (!atual) return res.status(404).json({ error: "Nota não encontrada." });
      if (atual.papel !== "prestador") return res.status(400).json({ error: "Só a nota emitida pelo cliente (prestador) pode ser cancelada por aqui." });
      try {
        const row = await cancelarNfse(atual.clientId, atual.id, req.body.motivo);
        await logAudit(req, "nfse.cancelamento", {
          targetType: "nfse_emissao",
          targetId: row.id,
          summary: `NFS-e nº ${row.numeroNota || row.id} cancelada (pelo contador)`,
          metadata: { clientId: row.clientId, chaveAcesso: row.chaveAcesso, motivo: req.body.motivo },
        });
        res.json({ ok: true, status: row.status, canceladaEm: row.canceladaEm });
      } catch (e) {
        if (sendNfseError(res, e)) return;
        throw e;
      }
    },
  );

  // Contador: apaga uma tentativa rejeitada de qualquer cliente.
  app.delete("/api/nfse/admin/emissoes/:id", verifyAccountantAuth, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
    try {
      const row = await getEmissaoById(req.params.id);
      await excluirEmissao(req.params.id);
      await logAudit(req, "nfse.emissao.excluida", {
        targetType: "nfse_emissao",
        targetId: req.params.id,
        summary: `Tentativa rejeitada descartada (${row?.rejeicaoCodigo || "sem código"})`,
        metadata: { clientId: row?.clientId, competencia: row?.competencia },
      });
      res.json({ ok: true });
    } catch (e) {
      if (sendNfseError(res, e)) return;
      throw e;
    }
  });

  // Contador: dispara a busca de DF-e (portal nacional) para um cliente.
  app.post(
    "/api/nfse/admin/clients/:id/sincronizar-dfe",
    verifyAccountantAuth,
    async (req, res) => {
      const client = await loadClientOr404(req.params.id, res);
      if (!client) return;
      const reiniciar = req.query.reiniciar === "1" || req.body?.reiniciar === true;
      try {
        const r = await sincronizarDistribuicao(client.id, { reiniciar });
        await logAudit(req, "nfse.distribuicao", {
          targetType: "client",
          targetId: client.id,
          summary: `Distribuição de DF-e: ${r.novas} nova(s), ${r.atualizadas} atualizada(s), ${r.eventos} evento(s)`,
          metadata: r,
        });
        res.json({ ok: true, ...r });
      } catch (e) {
        if (sendNfseError(res, e)) return;
        nfseLog("error", "distribuicao.falha", {
          clientId: client.id,
          msg: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack?.split("\n").slice(0, 4).join(" | ") : undefined,
        });
        res.status(502).json({ error: e instanceof Error ? e.message : "Falha ao sincronizar com o portal nacional." });
      }
    },
  );

  // Diagnóstico: baixa o XML da DPS assinada (?tipo=dps) ou da NFS-e (?tipo=nfse)
  // de uma emissão. Só o contador; útil para investigar rejeição.
  app.get("/api/nfse/admin/emissoes/:id/xml", verifyAccountantAuth, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
    const row = await getEmissaoById(req.params.id);
    if (!row) return res.status(404).json({ error: "Emissão não encontrada." });
    const tipo = req.query.tipo === "nfse" ? "nfse" : "dps";
    const xml = tipo === "nfse" ? row.xmlNfse : row.xmlDps;
    if (!xml) return res.status(404).json({ error: `XML ${tipo === "nfse" ? "da NFS-e" : "da DPS"} não disponível.` });
    await logAudit(req, "nfse.xml.download", {
      targetType: "nfse_emissao",
      targetId: row.id,
      summary: `Download do XML ${tipo} da emissão`,
    });
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${tipo}-${row.idDps || row.id}.xml"`,
    );
    res.send(xml);
  });

  app.get("/api/nfse/admin/clients/:id", verifyAccountantAuth, async (req, res) => {
    const client = await loadClientOr404(req.params.id, res);
    if (!client) return;
    const config = await getClientConfig(client.id);
    const atividades = await listAtividades(client.id);
    const esc = await infoCertEscritorio();
    res.json({
      client: { id: client.id, name: client.name, cnpj: client.cnpj, cnpjFormatado: formatCnpj(client.cnpj) },
      config: nfseConfigDTO(config, await certFileExists(config)),
      atividades: atividades.map(nfseAtividadeAdminDTO),
      // Certificado do escritório (Integra Contador) — para emitir por procuração.
      certEscritorio: esc ? { cnpj: esc.cnpj ? formatCnpj(esc.cnpj) : null, validadeAte: esc.validadeAte, vencido: esc.vencido } : null,
    });
  });

  app.put(
    "/api/nfse/admin/clients/:id/config",
    verifyAccountantAuth,
    uploadNfseCert.single("cert"),
    validateBody(nfseConfigSchema),
    async (req, res) => {
      const client = await loadClientOr404(req.params.id, res);
      if (!client) {
        if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
        return;
      }
      const b = req.body as Record<string, any>;
      const input = {
        codigoMunicipio: blank(b.codigoMunicipio),
        regimeTributario: blank(b.regimeTributario),
        regimeEspecialTrib: blank(b.regimeEspecialTrib),
        optanteSimplesNacional: b.optanteSimplesNacional,
        incentivoFiscal: b.incentivoFiscal,
        ambiente: blank(b.ambiente),
        serieDps: blank(b.serieDps),
        ativo: b.ativo,
        certSenha: blank(b.certSenha),
        usarProcuracao: b.usarProcuracao,
      };
      try {
        const { config, warnings } = await upsertClientConfig(
          client.id,
          client.cnpj,
          input,
          req.file?.path,
        );
        await logAudit(req, "nfse.config.update", {
          targetType: "client",
          targetId: client.id,
          summary: `NFS-e config atualizada${req.file ? " (novo certificado)" : ""}${input.usarProcuracao !== undefined ? (config.usarProcuracao ? " (emite por procuração)" : " (emite com o certificado do cliente)") : ""}`,
          metadata: { ativo: config.ativo, ambiente: config.ambiente, municipio: config.codigoMunicipio, usarProcuracao: config.usarProcuracao },
        });
        res.json({
          config: nfseConfigDTO(config, await certFileExists(config)),
          warnings,
        });
      } catch (e) {
        if (sendNfseError(res, e)) return;
        throw e;
      }
    },
  );

  app.post(
    "/api/nfse/admin/clients/:id/atividades",
    verifyAccountantAuth,
    validateBody(nfseAtividadeSchema),
    async (req, res) => {
      const client = await loadClientOr404(req.params.id, res);
      if (!client) return;
      const atividade = await createAtividade(client.id, req.body);
      await logAudit(req, "nfse.atividade.create", {
        targetType: "client",
        targetId: client.id,
        summary: `Atividade NFS-e "${atividade.nome}" criada`,
      });
      res.json({ atividade: nfseAtividadeAdminDTO(atividade) });
    },
  );

  app.put(
    "/api/nfse/admin/clients/:id/atividades/:atividadeId",
    verifyAccountantAuth,
    validateBody(nfseAtividadeSchema),
    async (req, res) => {
      const client = await loadClientOr404(req.params.id, res);
      if (!client) return;
      if (!isUuid(req.params.atividadeId)) return res.status(400).json({ error: "ID inválido." });
      const atividade = await updateAtividade(client.id, req.params.atividadeId, req.body);
      if (!atividade) return res.status(404).json({ error: "Atividade não encontrada." });
      await logAudit(req, "nfse.atividade.update", {
        targetType: "client",
        targetId: client.id,
        summary: `Atividade NFS-e "${atividade.nome}" atualizada`,
      });
      res.json({ atividade: nfseAtividadeAdminDTO(atividade) });
    },
  );

  app.delete(
    "/api/nfse/admin/clients/:id/atividades/:atividadeId",
    verifyAccountantAuth,
    async (req, res) => {
      const client = await loadClientOr404(req.params.id, res);
      if (!client) return;
      if (!isUuid(req.params.atividadeId)) return res.status(400).json({ error: "ID inválido." });
      const ok = await deleteAtividade(client.id, req.params.atividadeId);
      if (!ok) return res.status(404).json({ error: "Atividade não encontrada." });
      await logAudit(req, "nfse.atividade.delete", {
        targetType: "client",
        targetId: client.id,
        summary: "Atividade NFS-e removida",
      });
      res.json({ ok: true });
    },
  );

  // Health check for a client's setup: the certificate opens, isn't expired, its
  // CNPJ matches, and — over mTLS — the emitter's município is conveniado ao
  // padrão nacional (only conveniado municipalities can emit via Sefin Nacional).
  app.post("/api/nfse/admin/clients/:id/test", verifyAccountantAuth, async (req, res) => {
    const client = await loadClientOr404(req.params.id, res);
    if (!client) return;
    try {
      const ctx = await loadClientCertContext(client.id);
      const base = {
        ok: true as boolean,
        ambiente: ctx.config.ambiente,
        // Por procuração: o certificado testado é o do escritório.
        procuracao: ctx.procuracao,
        certCnpj: ctx.procuracao
          ? (ctx.parsed.cnpj ? formatCnpj(ctx.parsed.cnpj) : null)
          : ctx.config.certCnpj ? formatCnpj(ctx.config.certCnpj) : null,
        certValidadeAte: ctx.procuracao ? ctx.parsed.notAfter : ctx.config.certValidadeAte,
        codigoMunicipio: ctx.config.codigoMunicipio,
        convenio: null as null | { aderente: boolean },
        aviso: null as string | null,
      };

      const cod = String(ctx.config.codigoMunicipio || "").replace(/\D/g, "");
      if (cod.length === 7) {
        try {
          const conv = await getConvenio(
            ctx.agent,
            ctx.config.ambiente === "producao" ? "producao" : "homologacao",
            cod,
          );
          base.convenio = { aderente: conv.aderente };
          if (!conv.aderente) {
            base.aviso = "O município informado ainda não aderiu ao padrão nacional de NFS-e.";
          }
        } catch (err: any) {
          base.aviso = `Não foi possível consultar o convênio do município: ${err?.message || err}`;
        }
      } else {
        base.aviso = "Informe o código IBGE (7 dígitos) do município emissor.";
      }

      res.json(base);
    } catch (e) {
      if (e instanceof NfseError) {
        return res.json({ ok: false, error: e.message, reason: e.reason ?? null });
      }
      throw e;
    }
  });
}
