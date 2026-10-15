import { Express } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { clients, fiscalNotificacoes, fiscalPerfil, fiscalStatus, parcelamentos } from "../schema";
import { verifyAccountantAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import {
  fiscalAtualizarSchema,
  fiscalNotificacoesLidasSchema,
  fiscalPerfilSchema,
  parcelamentoSchema,
} from "../schemas/validation";
import { logAudit } from "../services/audit";
import { isUuid } from "../services/serpro";
import { montarPainel } from "../services/fiscal/painel";
import {
  avaliarCliente,
  buscarParcelamentosSerpro,
  processosDoCliente,
  rodarRotinaDiaria,
} from "../services/fiscal/monitor";
import { LimiteSerproError } from "../services/fiscal/integra";

// Painel de pendências fiscais (só o contador). As ações que podem gastar
// consultas no Integra Contador ficam registradas na auditoria.

let rotinaEmAndamento = false;

function erro(res: any, e: unknown) {
  const status = e instanceof LimiteSerproError ? 429 : Number((e as any)?.status) || 500;
  res.status(status).json({ error: e instanceof Error ? e.message : "Falha no painel fiscal." });
}

async function clienteOu404(id: string, res: any) {
  if (!isUuid(id)) {
    res.status(400).json({ error: "ID de cliente inválido." });
    return null;
  }
  const [c] = await db.select().from(clients).where(eq(clients.id, id));
  if (!c) res.status(404).json({ error: "Cliente não encontrado." });
  return c ?? null;
}

export function registerFiscalRoutes(app: Express) {
  app.get("/api/accountant/fiscal/painel", verifyAccountantAuth, async (_req, res) => {
    try {
      // Cliente ainda sem avaliação: calcula pelas guias do portal (sem SERPRO).
      const avaliados = new Set((await db.select({ id: fiscalStatus.clientId }).from(fiscalStatus)).map((r) => r.id));
      for (const c of await db.select({ id: clients.id }).from(clients)) {
        if (!avaliados.has(c.id)) await avaliarCliente(c.id, { consultarSerpro: false, origem: "manual" });
      }
      res.json({ ...(await montarPainel()), rotinaEmAndamento });
    } catch (e) {
      erro(res, e);
    }
  });

  // Roda agora a rotina diária (eventos + avaliação de todos). Em segundo plano:
  // os eventos levam alguns segundos de espera no SERPRO.
  app.post("/api/accountant/fiscal/rotina", verifyAccountantAuth, validateBody(fiscalAtualizarSchema), async (req, res) => {
    if (rotinaEmAndamento) return res.status(409).json({ error: "A verificação já está em andamento." });
    rotinaEmAndamento = true;
    await logAudit(req, "fiscal.rotina_manual", { summary: "Verificação fiscal de todos os clientes disparada manualmente" });
    void rodarRotinaDiaria("manual").finally(() => {
      rotinaEmAndamento = false;
    });
    res.status(202).json({ ok: true });
  });

  app.get("/api/accountant/fiscal/clientes/:id", verifyAccountantAuth, async (req, res) => {
    const c = await clienteOu404(req.params.id, res);
    if (!c) return;
    const [perfil] = await db.select().from(fiscalPerfil).where(eq(fiscalPerfil.clientId, c.id));
    res.json({
      cliente: { id: c.id, nome: c.name, cnpj: c.cnpj },
      perfil: { regime: perfil?.regime ?? null, processos: perfil?.processos ?? null },
      processosEfetivos: await processosDoCliente(c.id),
      status: await db.select().from(fiscalStatus).where(eq(fiscalStatus.clientId, c.id)),
      parcelamentos: await db.select().from(parcelamentos).where(eq(parcelamentos.clientId, c.id)),
    });
  });

  app.post("/api/accountant/fiscal/clientes/:id/atualizar", verifyAccountantAuth, validateBody(fiscalAtualizarSchema), async (req, res) => {
    const c = await clienteOu404(req.params.id, res);
    if (!c) return;
    const consultarSerpro = !!req.body.consultarSerpro;
    try {
      if (consultarSerpro) {
        await logAudit(req, "fiscal.cliente_serpro", { targetType: "client", targetId: c.id, summary: `Verificação fiscal com consulta ao SERPRO: ${c.name}` });
      }
      await avaliarCliente(c.id, { consultarSerpro, origem: "manual", forcar: consultarSerpro });
      res.json({ ok: true });
    } catch (e) {
      erro(res, e);
    }
  });

  app.put("/api/accountant/fiscal/clientes/:id/perfil", verifyAccountantAuth, validateBody(fiscalPerfilSchema), async (req, res) => {
    const c = await clienteOu404(req.params.id, res);
    if (!c) return;
    const values = { clientId: c.id, regime: req.body.regime ?? null, processos: (req.body.processos ?? null) as any, updatedAt: new Date() };
    await db.insert(fiscalPerfil).values(values).onConflictDoUpdate({ target: fiscalPerfil.clientId, set: values });
    await avaliarCliente(c.id, { consultarSerpro: false, origem: "manual" });
    res.json({ ok: true });
  });

  app.post("/api/accountant/fiscal/clientes/:id/parcelamentos", verifyAccountantAuth, validateBody(parcelamentoSchema), async (req, res) => {
    const c = await clienteOu404(req.params.id, res);
    if (!c) return;
    const b = req.body;
    try {
      await db.insert(parcelamentos).values({
        clientId: c.id,
        modalidade: b.modalidade,
        numero: b.numero,
        situacao: b.situacao || null,
        origem: "manual",
        valorParcela: b.valorParcela ?? null,
        parcelasTotal: b.parcelasTotal ?? null,
        diaVencimento: b.diaVencimento ?? null,
        ultimoPagamento: b.ultimoPagamento || null,
        ativo: b.ativo ?? true,
      });
    } catch {
      return res.status(409).json({ error: "Já existe um parcelamento com essa modalidade e número." });
    }
    await logAudit(req, "fiscal.parcelamento_criar", { targetType: "client", targetId: c.id, summary: `Parcelamento ${b.modalidade} ${b.numero}` });
    await avaliarCliente(c.id, { consultarSerpro: false, origem: "manual" });
    res.json({ ok: true });
  });

  app.put("/api/accountant/fiscal/parcelamentos/:pid", verifyAccountantAuth, validateBody(parcelamentoSchema), async (req, res) => {
    if (!isUuid(req.params.pid)) return res.status(400).json({ error: "ID inválido." });
    const [p] = await db.select().from(parcelamentos).where(eq(parcelamentos.id, req.params.pid));
    if (!p) return res.status(404).json({ error: "Parcelamento não encontrado." });
    const b = req.body;
    await db
      .update(parcelamentos)
      .set({
        // Os do SERPRO só deixam mudar o que o SERPRO não informa.
        ...(p.origem === "manual" ? { modalidade: b.modalidade, numero: b.numero, situacao: b.situacao || null, ultimoPagamento: b.ultimoPagamento || null } : {}),
        valorParcela: b.valorParcela ?? p.valorParcela,
        parcelasTotal: b.parcelasTotal ?? p.parcelasTotal,
        diaVencimento: b.diaVencimento ?? p.diaVencimento,
        ativo: b.ativo ?? p.ativo,
        updatedAt: new Date(),
      })
      .where(eq(parcelamentos.id, p.id));
    await avaliarCliente(p.clientId, { consultarSerpro: false, origem: "manual" });
    res.json({ ok: true });
  });

  app.delete("/api/accountant/fiscal/parcelamentos/:pid", verifyAccountantAuth, async (req, res) => {
    if (!isUuid(req.params.pid)) return res.status(400).json({ error: "ID inválido." });
    const [p] = await db.delete(parcelamentos).where(eq(parcelamentos.id, req.params.pid)).returning();
    if (!p) return res.status(404).json({ error: "Parcelamento não encontrado." });
    await logAudit(req, "fiscal.parcelamento_excluir", { targetType: "client", targetId: p.clientId, summary: `Parcelamento ${p.modalidade} ${p.numero}` });
    await avaliarCliente(p.clientId, { consultarSerpro: false, origem: "manual" });
    res.json({ ok: true });
  });

  // Descobre os parcelamentos do Simples no SERPRO (4 consultas).
  app.post("/api/accountant/fiscal/clientes/:id/parcelamentos/buscar", verifyAccountantAuth, validateBody(fiscalAtualizarSchema), async (req, res) => {
    const c = await clienteOu404(req.params.id, res);
    if (!c) return;
    try {
      await logAudit(req, "fiscal.parcelamentos_serpro", { targetType: "client", targetId: c.id, summary: `Busca de parcelamentos do Simples no SERPRO: ${c.name}` });
      res.json({ ok: true, ...(await buscarParcelamentosSerpro(c.id, "manual")) });
    } catch (e) {
      erro(res, e);
    }
  });

  app.post("/api/accountant/fiscal/notificacoes/lidas", verifyAccountantAuth, validateBody(fiscalNotificacoesLidasSchema), async (req, res) => {
    const ids: number[] | undefined = req.body.ids;
    await db
      .update(fiscalNotificacoes)
      .set({ lida: true })
      .where(ids?.length ? and(eq(fiscalNotificacoes.lida, false), inArray(fiscalNotificacoes.id, ids)) : eq(fiscalNotificacoes.lida, false));
    res.json({ ok: true });
  });
}
