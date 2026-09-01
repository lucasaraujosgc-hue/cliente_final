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
import { LISTA_SERVICOS_LC116 } from "../../lib/listaServicosLC116";
import {
  nfseConfigSchema,
  nfseAtividadeSchema,
  nfseCnpjLookupSchema,
  nfseEmitSchema,
  nfseCancelSchema,
} from "../schemas/validation";
import {
  nfseStatusForClient,
  listEmissoes,
  getEmissao,
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
  lookupCnpj,
  emitirNfse,
  reconcileEmissao,
  cancelarNfse,
  getDanfsePdfPath,
  getConvenio,
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
function blank(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

export function registerNfseRoutes(app: Express) {
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
      const b = req.body;
      try {
        const emissao = await emitirNfse(clientId, {
          atividadeId: b.atividadeId,
          tomador: {
            doc: b.tomador.doc,
            nome: b.tomador.nome,
            email: b.tomador.email || undefined,
            telefone: b.tomador.telefone || undefined,
            inscricaoMunicipal: b.tomador.inscricaoMunicipal || undefined,
            endereco: b.tomador.endereco || undefined,
          },
          descricao: b.descricao,
          valor: b.valor,
          competencia: b.competencia || undefined,
        });
        await logAudit(req, "nfse.emissao", {
          targetType: "nfse_emissao",
          targetId: emissao.id,
          summary: `NFS-e ${emissao.status}${emissao.numeroNota ? ` nº ${emissao.numeroNota}` : ""}`,
          metadata: {
            status: emissao.status,
            ambiente: emissao.ambiente,
            idDps: emissao.idDps,
            chaveAcesso: emissao.chaveAcesso,
          },
        });
        res.json({
          ok: emissao.status === "emitida",
          processando: emissao.status === "processando",
          id: emissao.id,
          status: emissao.status,
          chaveAcesso: emissao.chaveAcesso,
          numeroNota: emissao.numeroNota,
        });
      } catch (e) {
        if (sendNfseError(res, e)) return;
        throw e;
      }
    },
  );

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

  app.get("/api/nfse/emissoes/:id/danfse", verifyClientAuth, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
    const emissao = await getEmissao(getClientId(req), req.params.id);
    if (!emissao) return res.status(404).json({ error: "Emissão não encontrada." });
    try {
      const pdfPath = await getDanfsePdfPath(emissao);
      const download = req.query.download === "1";
      await sendDiskFile(res, pdfPath, {
        disposition: download ? "attachment" : "inline",
        downloadName: `NFSe-${emissao.numeroNota || emissao.id}.pdf`,
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

  app.get("/api/nfse/admin/clients/:id", verifyAccountantAuth, async (req, res) => {
    const client = await loadClientOr404(req.params.id, res);
    if (!client) return;
    const config = await getClientConfig(client.id);
    const atividades = await listAtividades(client.id);
    res.json({
      client: { id: client.id, name: client.name, cnpj: client.cnpj, cnpjFormatado: formatCnpj(client.cnpj) },
      config: nfseConfigDTO(config, await certFileExists(config)),
      atividades: atividades.map(nfseAtividadeAdminDTO),
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
          summary: `NFS-e config atualizada${req.file ? " (novo certificado)" : ""}`,
          metadata: { ativo: config.ativo, ambiente: config.ambiente, municipio: config.codigoMunicipio },
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
        certCnpj: ctx.config.certCnpj ? formatCnpj(ctx.config.certCnpj) : null,
        certValidadeAte: ctx.config.certValidadeAte,
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
