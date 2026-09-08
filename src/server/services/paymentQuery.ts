import { and, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, clients, documents, paymentChecks } from "../schema";
import { buildSerproContext, getSerproToken, serproPost } from "./serpro";
import { mapWithConcurrency } from "./concurrencyPool";
import { sendClientNotification } from "./push";
import { loadDocumentPdfBuffer } from "./files";
import { logger } from "./logger";

// --- Integra Contador service for the payment query --------------------------
// SERPRO's PAGTOWEB "Consultar Pagamentos" (Integra Pagamento). The service
// only ever returns documents that were *arrecadados* (paid): a hit with a
// `dataArrecadacao` means the guia was paid; an empty list means it wasn't.
// Query modes:
//   - by document number  → { numeroDocumentoLista: [num] }   (most reliable)
//   - fallback by window   → { intervaloDataArrecadacao, intervaloValorTotalDocumento }
// `primeiroDaPagina` + `tamanhoDaPagina` are mandatory. `dados` is a JSON
// string inside `pedidoDados`. idSistema/idServico are overridable by env for
// contract differences without a code change.
const PAGTOWEB_SISTEMA = process.env.SERPRO_PAGTOWEB_SISTEMA || "PAGTOWEB";
const PAGTOWEB_SERVICO = process.env.SERPRO_PAGTOWEB_SERVICO || "PAGAMENTOS71";
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

// --- reading / caching the "número do documento" ----------------------------

interface DocForQuery {
  id?: string;
  category?: string | null;
  title?: string | null;
  competence?: string | null;
  dueDate?: string | null;
  extractedData?: unknown;
  fileUrl?: string | null;
}

// The number/value we can pull straight from `documents.extracted_data`.
function readExtracted(doc: DocForQuery): { numeroDocumento?: string; extractedValue?: number } {
  const ed = doc.extractedData;
  if (ed && typeof ed === "object" && !Array.isArray(ed)) {
    const o = ed as Record<string, unknown>;
    return {
      numeroDocumento:
        typeof o.numeroDocumento === "string" && o.numeroDocumento ? o.numeroDocumento : undefined,
      extractedValue: typeof o.extractedValue === "number" ? o.extractedValue : undefined,
    };
  }
  return {};
}

// Cache a freshly-extracted document number back onto the row, preserving the
// rest of extracted_data (same shape handling as the guia recálculo flow).
async function persistDocNumber(docId: string, existing: unknown, numero: string): Promise<void> {
  let ed: any = existing;
  if (!ed || typeof ed !== "object") ed = {};
  else if (Array.isArray(ed)) ed = { array: ed };
  ed = { ...ed, numeroDocumento: numero };
  await db.update(documents).set({ extractedData: ed }).where(eq(documents.id, docId));
}

// --- fallback query window --------------------------------------------------

function parseStoredDate(d?: string | null): Date | null {
  if (!d) return null;
  const iso = d.includes("/") ? d.split("/").reverse().join("-") : d.split("T")[0];
  const t = Date.parse(iso);
  return isNaN(t) ? null : new Date(t);
}

const DAY_MS = 86_400_000;

// Arrecadação (payment) date range for the fallback query: from a bit before
// the due date to ~2 months after, capped at today. Falls back to the
// competence month when there is no due date.
function paymentDateWindow(doc: DocForQuery): { dataInicial: string; dataFinal: string } | null {
  let start: Date | null = null;
  let end: Date | null = null;
  const due = parseStoredDate(doc.dueDate);
  if (due) {
    start = new Date(due.getTime() - 10 * DAY_MS);
    end = new Date(due.getTime() + 60 * DAY_MS);
  } else if (doc.competence && /^\d{2}\/\d{4}$/.test(doc.competence)) {
    const [m, y] = doc.competence.split("/").map(Number);
    start = new Date(Date.UTC(y, m - 1, 1));
    end = new Date(Date.UTC(y, m + 1, 0));
  }
  if (!start || !end) return null;
  const today = new Date();
  if (end > today) end = today;
  if (start > end) return null;
  return { dataInicial: start.toISOString().slice(0, 10), dataFinal: end.toISOString().slice(0, 10) };
}

// --- reading the SERPRO PAGTOWEB response -----------------------------------

// PAGTOWEB "Consultar Pagamentos" only ever returns documents that were
// *arrecadados* (paid), so an item carrying a `dataArrecadacao` means the guia
// was paid. `dados` arrives as a stringified JSON array inside the envelope.
// In fallback mode (queried by date window, not document number) we require the
// amount to match so an unrelated payment in the window can't produce a false
// positive.
function interpretPaymentResponse(
  root: any,
  opts: { expectedValue?: number; requireValueMatch: boolean },
): { paid: boolean; paidAt?: string } {
  let dados = root?.dados ?? root;
  for (let i = 0; i < 2 && typeof dados === "string"; i++) {
    try {
      dados = JSON.parse(dados);
    } catch {
      break;
    }
  }

  const list: any[] = Array.isArray(dados)
    ? dados
    : Array.isArray(dados?.documentos)
      ? dados.documentos
      : Array.isArray(dados?.pagamentos)
        ? dados.pagamentos
        : dados && typeof dados === "object"
          ? [dados]
          : [];

  for (const item of list) {
    const paidAt = item?.dataArrecadacao ?? item?.dataPagamento ?? null;
    if (!paidAt) continue;
    if (opts.requireValueMatch) {
      if (opts.expectedValue == null) continue;
      const total = Number(item?.valorTotal ?? item?.valorPrincipal ?? 0);
      if (!(Math.abs(total - opts.expectedValue) <= 0.5)) continue;
    }
    return { paid: true, paidAt: String(paidAt) };
  }
  return { paid: false };
}

// --- the SERPRO call -----------------------------------------------------------

export async function consultarPagamentoNoSerpro(
  client: { cnpj: string },
  doc: DocForQuery,
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

  // Resolve the document number: stored on extracted_data, or parsed from the
  // guia PDF once and cached back (best-effort — null just means we fall back
  // to the date/value window query).
  let { numeroDocumento, extractedValue } = readExtracted(doc);
  if (!numeroDocumento && doc.id && doc.fileUrl) {
    try {
      const buf = await loadDocumentPdfBuffer(doc.fileUrl);
      if (buf) {
        const { extractDocNumberFromPdf } = await import("../qrExtractor");
        const found = await extractDocNumberFromPdf(buf);
        if (found) {
          numeroDocumento = found;
          await persistDocNumber(doc.id, doc.extractedData, found).catch(() => {});
        }
      }
    } catch {
      /* fall back to the window query */
    }
  }

  const byNumber = !!numeroDocumento;
  const dados: Record<string, unknown> = { primeiroDaPagina: 0, tamanhoDaPagina: 100 };
  if (byNumber) {
    dados.numeroDocumentoLista = [numeroDocumento];
  } else {
    // Without a document number we can only match on value; with neither we
    // could never confirm a payment — skip the call.
    if (extractedValue == null || !(extractedValue > 0)) {
      return { outcome: "not_found", raw: "sem número do documento nem valor para confrontar" };
    }
    const win = paymentDateWindow(doc);
    if (!win) return { outcome: "not_found", raw: "sem número do documento nem janela de datas" };
    dados.intervaloDataArrecadacao = win;
    dados.intervaloValorTotalDocumento = {
      valorInicial: Number((extractedValue - 0.5).toFixed(2)),
      valorFinal: Number((extractedValue + 0.5).toFixed(2)),
    };
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
      dados: JSON.stringify(dados),
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
    const { paid, paidAt } = interpretPaymentResponse(root, {
      expectedValue: extractedValue,
      requireValueMatch: !byNumber,
    });
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
  notify = true,
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

  if (doc && notify) {
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

export interface ManualMarkResult {
  selected: number;
  marked: number;
  skipped: number;
  ranAt: string;
}

// Accountant marks a set of guias as paid by hand (no SERPRO call). Same
// portal-wide effect as a detected payment (documents.status -> "paid",
// payment_checks -> PAGO, audit trail) but the client is NOT notified. Guias
// already PAGO are left untouched.
export async function markPaymentsManual(documentIds: string[]): Promise<ManualMarkResult> {
  const ids = Array.from(new Set(documentIds)).slice(0, 150);
  const now = new Date();
  if (ids.length === 0) {
    return { selected: 0, marked: 0, skipped: 0, ranAt: now.toISOString() };
  }

  const docs = await db.select().from(documents).where(inArray(documents.id, ids));
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

  const checks = await db
    .select()
    .from(paymentChecks)
    .where(inArray(paymentChecks.documentId, ids));

  let marked = 0;
  for (const check of checks) {
    if (check.status === "PAGO") continue;
    await markGuiaPaid(check, "accountant", undefined, false);
    marked++;
  }

  return { selected: ids.length, marked, skipped: ids.length - marked, ranAt: now.toISOString() };
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
