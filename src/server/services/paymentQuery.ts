import { and, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, clients, documents, paymentChecks } from "../schema";
import { buildSerproContext, getSerproToken, serproPost } from "./serpro";
import { mapWithConcurrency } from "./concurrencyPool";
import { sendClientNotification } from "./push";
import { logger } from "./logger";

// --- Integra Contador service for the payment query --------------------------
// There is no official "was this DARF paid?" endpoint that fits every case; the
// closest is PAGTOWEB (consulta de arrecadação / comprovantes por CNPJ). The
// exact idSistema/idServico can differ per SERPRO contract, so both are
// overridable by env without a code change.
const PAGTOWEB_SISTEMA = process.env.SERPRO_PAGTOWEB_SISTEMA || "PAGTOWEB";
const PAGTOWEB_SERVICO = process.env.SERPRO_PAGTOWEB_SERVICO || "CONSULTARPAGAMENTOS169";
const PAGTOWEB_ENDPOINT = process.env.SERPRO_PAGTOWEB_ENDPOINT || "Consultar";

// Cadence knobs (all overridable, sane defaults).
const MAX_ATTEMPTS = Number(process.env.PAYMENT_QUERY_MAX_ATTEMPTS) || 8;
const RETRY_NOT_FOUND_HOURS = Number(process.env.PAYMENT_QUERY_RETRY_HOURS) || 48;
const RETRY_ERROR_HOURS = 6;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
const SWEEP_CONCURRENCY = Number(process.env.PAYMENT_QUERY_CONCURRENCY) || 3;

export type PaymentOutcome =
  | "paid"
  | "not_found"
  | "error"
  | "not_configured"
  | "not_applicable";

// --- helpers ---------------------------------------------------------------

// Brazil has no DST since 2019, so BRT is a stable UTC-3. "Tomorrow 08:00 BRT".
function nextMorningBRT(from = new Date()): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(11, 0, 0, 0); // 08:00 BRT
  return d;
}

// Only federal revenue guias (DAS / DARF / DCTFWEB) can be checked via PAGTOWEB.
// FGTS (Caixa), folha, company docs etc. are not applicable.
export function isFederalGuia(doc: { category?: string | null; title?: string | null; dueDate?: string | null }): boolean {
  if (!doc.dueDate) return false;
  const hay = `${doc.category || ""} ${doc.title || ""}`.toUpperCase();
  if (/(FGTS|CONTRACHEQUE|FOLHA|PAYROLL|SITFIS|EXTRATO)/.test(hay)) return false;
  return /(DAS|DARF|DCTFWEB|SIMPLES|INSS|PGDASD|IMPOSTO|TRIBUT)/.test(hay);
}

// Best-effort read of the SERPRO PAGTOWEB response. Kept isolated and
// conservative: only report "paid" when the payload positively shows a
// settled payment, otherwise "not_found". Tune against real responses.
function interpretPaymentResponse(raw: any): { paid: boolean; paidAt?: string } {
  let dados = raw?.dados ?? raw;
  if (typeof dados === "string") {
    try {
      dados = JSON.parse(dados);
    } catch {
      /* leave as string */
    }
  }
  if (typeof dados === "string") {
    try {
      dados = JSON.parse(dados);
    } catch {
      /* still a string */
    }
  }

  const list: any[] = Array.isArray(dados)
    ? dados
    : Array.isArray(dados?.pagamentos)
      ? dados.pagamentos
      : Array.isArray(dados?.arrecadacoes)
        ? dados.arrecadacoes
        : Array.isArray(dados?.documentos)
          ? dados.documentos
          : dados
            ? [dados]
            : [];

  for (const item of list) {
    const situacao = String(item?.situacao ?? item?.status ?? "").toUpperCase();
    const paidAt =
      item?.dataArrecadacao ??
      item?.dataPagamento ??
      item?.dataArrecadacaoDebito ??
      null;
    const valorPago = Number(item?.valorTotal ?? item?.valorPago ?? item?.valorRecolhido ?? 0);
    if (
      situacao.includes("PAGO") ||
      situacao.includes("QUITAD") ||
      situacao.includes("LIQUIDAD") ||
      (paidAt && valorPago > 0)
    ) {
      return { paid: true, paidAt: paidAt || undefined };
    }
  }
  return { paid: false };
}

// --- the SERPRO call -----------------------------------------------------------

export async function consultarPagamentoNoSerpro(
  client: { cnpj: string },
  doc: { category?: string | null; title?: string | null; competence?: string | null; dueDate?: string | null },
): Promise<{ outcome: PaymentOutcome; paidAt?: string; raw?: string }> {
  if (!isFederalGuia(doc)) return { outcome: "not_applicable" };

  let ctx;
  try {
    ctx = await buildSerproContext();
  } catch (e: any) {
    if (e?.reason === "not_configured" || e?.reason === "cert_missing") {
      return { outcome: "not_configured" };
    }
    return { outcome: "error", raw: String(e?.message || e) };
  }

  // Period for the query — from the guia's competence (MM/YYYY) or due date.
  let anoPA = "";
  let mesPA = "";
  if (doc.competence && /^\d{2}\/\d{4}$/.test(doc.competence)) {
    const [m, y] = doc.competence.split("/");
    anoPA = y;
    mesPA = m;
  } else if (doc.dueDate) {
    const d = doc.dueDate.includes("/")
      ? doc.dueDate.split("/").reverse().join("-")
      : doc.dueDate.split("T")[0];
    const parts = d.split("-");
    anoPA = parts[0];
    mesPA = parts[1];
  }

  const contribuinte = client.cnpj.replace(/\D/g, "");
  const payload = {
    contratante: { numero: ctx.cnpjContratante, tipo: 2 },
    autorPedidoDados: { numero: ctx.cnpjContratante, tipo: 2 },
    contribuinte: { numero: contribuinte, tipo: 2 },
    pedidoDados: {
      idSistema: PAGTOWEB_SISTEMA,
      idServico: PAGTOWEB_SERVICO,
      versaoSistema: "1.0",
      dados: JSON.stringify({
        contribuinte,
        anoPA,
        mesPA,
        dataInicial: anoPA && mesPA ? `${anoPA}-${mesPA}-01` : undefined,
      }),
    },
  };

  try {
    const tokens = await getSerproToken(ctx.config, ctx.certAgent);
    const resp = await serproPost(
      `${ctx.baseUrl}/${PAGTOWEB_ENDPOINT}`,
      tokens,
      payload,
      ctx.certAgent,
    );
    const text = await resp.text();
    if (!resp.ok) {
      // A 404 from SERPRO means "no record" — treat as not found, not error.
      if (resp.status === 404) return { outcome: "not_found", raw: text.slice(0, 500) };
      return { outcome: "error", raw: `SERPRO ${resp.status}: ${text.slice(0, 500)}` };
    }
    let root: any;
    try {
      root = JSON.parse(text);
    } catch {
      return { outcome: "error", raw: `resposta não-JSON: ${text.slice(0, 300)}` };
    }
    const { paid, paidAt } = interpretPaymentResponse(root);
    return { outcome: paid ? "paid" : "not_found", paidAt, raw: text.slice(0, 500) };
  } catch (e: any) {
    return { outcome: "error", raw: String(e?.message || e) };
  }
}

// --- interaction recording (frontend trigger) --------------------------------

export type InteractionType = "view" | "copy_pix" | "copy_barcode" | "manual";

// Called when the client opens / copies a guia. Idempotent per document: the
// unique document_id + COALESCE keeps a single scheduled check even if the
// client clicks many times in a row.
export async function recordGuiaInteraction(
  documentId: string,
  clientId: string,
  type: InteractionType,
): Promise<{ scheduled: boolean; nextCheckAt: Date | null }> {
  const now = new Date();
  const scheduledFor = nextMorningBRT(now);

  const [row] = await db
    .insert(paymentChecks)
    .values({
      documentId,
      clientId,
      status: "PENDENTE",
      lastInteractionAt: now,
      lastInteractionType: type,
      nextCheckAt: scheduledFor,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: paymentChecks.documentId,
      set: {
        lastInteractionAt: now,
        lastInteractionType: type,
        updatedAt: now,
        // Keep an existing schedule; only set one if there is none (or it lapsed
        // without ever running). Never re-arm a PAGO / NAO_APLICAVEL row.
        nextCheckAt: sql`CASE
          WHEN ${paymentChecks.status} IN ('PAGO', 'NAO_APLICAVEL') THEN ${paymentChecks.nextCheckAt}
          WHEN ${paymentChecks.nextCheckAt} IS NULL THEN ${scheduledFor}
          ELSE ${paymentChecks.nextCheckAt}
        END`,
      },
    })
    .returning();

  return {
    scheduled: !!row?.nextCheckAt && row.status !== "PAGO",
    nextCheckAt: row?.nextCheckAt ?? null,
  };
}

// --- applying an outcome to the DB ------------------------------------------

async function markGuiaPaid(
  check: typeof paymentChecks.$inferSelect,
  source: "serpro" | "accountant",
  paidAt?: string,
) {
  const now = new Date();
  await db
    .update(paymentChecks)
    .set({
      status: "PAGO",
      paidDetectedAt: now,
      paidSource: source,
      nextCheckAt: null,
      lastCheckedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(paymentChecks.id, check.id));

  // Reflect it across the whole portal (dashboard / cofre / atrasados all key
  // off documents.status). Don't downgrade a doc that's already paid.
  const [doc] = await db
    .update(documents)
    .set({ status: "paid" })
    .where(and(eq(documents.id, check.documentId), ne(documents.status, "paid")))
    .returning();

  await db
    .insert(auditLog)
    .values({
      actor: source === "serpro" ? "system" : "accountant",
      action: "payment.detected",
      targetType: "document",
      targetId: check.documentId,
      summary: `Pagamento identificado (${source})${paidAt ? ` em ${paidAt}` : ""}`,
      metadata: { checkId: check.id, source, paidAt: paidAt ?? null },
    })
    .catch(() => {});

  if (doc) {
    sendClientNotification(
      check.clientId,
      "Pagamento identificado",
      `Confirmamos o pagamento da guia "${doc.title || "guia"}". Nada mais a fazer.`,
    ).catch(() => {});
  }
}

// Runs one payment check and writes the result. Returns the outcome so callers
// (sweeper / batch) can aggregate.
export async function runOnePaymentCheck(
  check: typeof paymentChecks.$inferSelect,
  source: "serpro" | "accountant" = "serpro",
): Promise<PaymentOutcome> {
  const now = new Date();

  const [client] = await db.select().from(clients).where(eq(clients.id, check.clientId));
  const [doc] = await db.select().from(documents).where(eq(documents.id, check.documentId));
  if (!client || !doc) {
    await db
      .update(paymentChecks)
      .set({ status: "NAO_APLICAVEL", nextCheckAt: null, updatedAt: now })
      .where(eq(paymentChecks.id, check.id));
    return "not_applicable";
  }
  if (doc.status === "paid") {
    await db
      .update(paymentChecks)
      .set({ status: "PAGO", nextCheckAt: null, paidDetectedAt: check.paidDetectedAt ?? now, updatedAt: now })
      .where(eq(paymentChecks.id, check.id));
    return "paid";
  }

  const { outcome, paidAt, raw } = await consultarPagamentoNoSerpro(client, doc);

  if (outcome === "paid") {
    await markGuiaPaid(check, source, paidAt);
    return "paid";
  }

  if (outcome === "not_applicable") {
    await db
      .update(paymentChecks)
      .set({ status: "NAO_APLICAVEL", nextCheckAt: null, updatedAt: now })
      .where(eq(paymentChecks.id, check.id));
    return outcome;
  }

  if (outcome === "not_configured") {
    // Don't burn an attempt on our own misconfiguration; retry tomorrow.
    await db
      .update(paymentChecks)
      .set({
        lastCheckedAt: now,
        lastError: "Integra Contador não configurado",
        nextCheckAt: nextMorningBRT(now),
        updatedAt: now,
      })
      .where(eq(paymentChecks.id, check.id));
    return outcome;
  }

  const attempts = check.checkAttempts + 1;
  const stop = attempts >= MAX_ATTEMPTS;
  const retryHours = outcome === "error" ? RETRY_ERROR_HOURS : RETRY_NOT_FOUND_HOURS;
  await db
    .update(paymentChecks)
    .set({
      status: outcome === "error" ? "ERRO" : "PENDENTE",
      checkAttempts: attempts,
      lastCheckedAt: now,
      lastError: outcome === "error" ? (raw || "erro na consulta").slice(0, 500) : null,
      nextCheckAt: stop ? null : new Date(now.getTime() + retryHours * 3600 * 1000),
      updatedAt: now,
    })
    .where(eq(paymentChecks.id, check.id));
  return outcome;
}

// --- the background job -----------------------------------------------------

let sweepRunning = false;

export async function runPaymentQuerySweeper(): Promise<{ picked: number; paid: number }> {
  if (sweepRunning) return { picked: 0, paid: 0 };
  sweepRunning = true;
  try {
    const due = await db
      .select()
      .from(paymentChecks)
      .where(
        and(
          ne(paymentChecks.status, "PAGO"),
          ne(paymentChecks.status, "NAO_APLICAVEL"),
          isNotNull(paymentChecks.nextCheckAt),
          lte(paymentChecks.nextCheckAt, new Date()),
        ),
      )
      .limit(200);

    if (due.length === 0) return { picked: 0, paid: 0 };

    logger.info(`[Payment Sweeper] ${due.length} guia(s) para consultar`);
    const outcomes = await mapWithConcurrency(due, SWEEP_CONCURRENCY, (row) =>
      runOnePaymentCheck(row, "serpro").catch((e) => {
        logger.error("[Payment Sweeper] falha em uma consulta", { err: String(e) });
        return "error" as PaymentOutcome;
      }),
    );
    const paid = outcomes.filter((o) => o === "paid").length;
    logger.info(`[Payment Sweeper] concluído: ${paid} pagamento(s) identificado(s)`);
    return { picked: due.length, paid };
  } catch (err) {
    logger.error("[Payment Sweeper] falha na varredura", { err: String(err) });
    return { picked: 0, paid: 0 };
  } finally {
    sweepRunning = false;
  }
}

// --- on-demand batch (accountant) ------------------------------------------

export interface BatchResult {
  selected: number;
  checked: number;
  paid: number;
  notFound: number;
  errors: number;
  notApplicable: number;
  ranAt: string;
  results: { documentId: string; outcome: PaymentOutcome }[];
}

// Checks a set of guias now, with bounded concurrency. Creates a payment_checks
// row for any guia that doesn't have one yet (accountant-triggered).
export async function checkPaymentsForDocuments(documentIds: string[]): Promise<BatchResult> {
  const ids = Array.from(new Set(documentIds)).slice(0, 150);
  const now = new Date();

  const docs = ids.length
    ? await db.select().from(documents).where(inArray(documents.id, ids))
    : [];
  const docById = new Map(docs.map((d) => [d.id, d]));

  // Ensure a tracking row exists for each.
  for (const d of docs) {
    await db
      .insert(paymentChecks)
      .values({
        documentId: d.id,
        clientId: d.clientId,
        status: "PENDENTE",
        lastInteractionType: "manual",
        lastInteractionAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: paymentChecks.documentId });
  }

  const checks = ids.length
    ? await db.select().from(paymentChecks).where(inArray(paymentChecks.documentId, ids))
    : [];

  const results = await mapWithConcurrency(checks, SWEEP_CONCURRENCY, async (check) => {
    const outcome = await runOnePaymentCheck(check, "accountant").catch(() => "error" as PaymentOutcome);
    return { documentId: check.documentId, outcome };
  });

  return {
    selected: ids.length,
    checked: results.filter((r) => docById.has(r.documentId)).length,
    paid: results.filter((r) => r.outcome === "paid").length,
    notFound: results.filter((r) => r.outcome === "not_found").length,
    errors: results.filter((r) => r.outcome === "error" || r.outcome === "not_configured").length,
    notApplicable: results.filter((r) => r.outcome === "not_applicable").length,
    ranAt: now.toISOString(),
    results,
  };
}

// --- activation (same pattern as notificationSweeper.ts) --------------------

if (process.env.NODE_ENV !== "test") {
  setInterval(() => {
    runPaymentQuerySweeper().catch(() => {});
  }, SWEEP_INTERVAL_MS);
  setTimeout(() => {
    runPaymentQuerySweeper().catch(() => {});
  }, 15000);
}
