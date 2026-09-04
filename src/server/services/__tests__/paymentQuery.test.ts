import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../schema";

const pg = new PGlite();
const testDb = drizzle(pg, { schema });

vi.mock("../../db", () => ({ db: testDb, pool: {} }));
vi.mock("../push", () => ({ sendClientNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Controllable SERPRO transport — no real network.
const serproPost = vi.fn();
vi.mock("../serpro", () => ({
  isUuid: (s: string) => /^[0-9a-f-]{36}$/i.test(s),
  buildSerproContext: vi.fn().mockResolvedValue({
    config: { ambiente: "trial" },
    cnpjContratante: "00000000000100",
    baseUrl: "https://fake.serpro",
    certAgent: undefined,
  }),
  getSerproToken: vi.fn().mockResolvedValue({ access_token: "t", jwt_token: "j" }),
  serproPost: (...args: unknown[]) => serproPost(...args),
}));

// PDF-number extraction is exercised separately — mock the two collaborators so
// the query logic is deterministic and needs no poppler / canvas.
const loadDocumentPdfBuffer = vi.fn();
vi.mock("../files", () => ({
  loadDocumentPdfBuffer: (...args: unknown[]) => loadDocumentPdfBuffer(...args),
}));
const extractDocNumberFromPdf = vi.fn();
vi.mock("../../qrExtractor", () => ({
  extractDocNumberFromPdf: (...args: unknown[]) => extractDocNumberFromPdf(...args),
}));

const {
  recordGuiaInteraction,
  runPaymentQuerySweeper,
  checkPaymentsForDocuments,
  markPaymentsManual,
  consultarPagamentoNoSerpro,
  isFederalGuia,
} = await import("../paymentQuery");

// Build the PAGTOWEB envelope the real API returns: `dados` is a stringified
// JSON array of arrecadação records.
const serproEnvelope = (records: unknown[]) => ({
  ok: true,
  status: 200,
  text: async () =>
    JSON.stringify({
      status: 200,
      dados: JSON.stringify(records),
      mensagens: [{ codigo: "Sucesso-PAGTOWEB-00000", texto: "Requisição efetuada com sucesso." }],
    }),
});
const { mapWithConcurrency } = await import("../concurrencyPool");
const { paymentChecks, documents, clients } = schema;

const DRIZZLE = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"));
const migrationSqls: string[] = journal.entries.map((e: { tag: string }) =>
  fs.readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8"),
);

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

const T = 60_000;

async function seedGuia(id: string, over: Partial<typeof documents.$inferInsert> = {}) {
  await testDb.insert(documents).values({
    id,
    clientId: CLIENT_ID,
    title: "DAS — Simples Nacional",
    category: "DAS_SIMPLES",
    competence: "07/2026",
    dueDate: "2026-08-20",
    status: "pending",
    uploadedBy: "accountant",
    ...over,
  });
}

beforeAll(async () => {
  for (const sql of migrationSqls) await pg.exec(sql);
}, T);

beforeEach(async () => {
  await pg.exec(
    `TRUNCATE payment_checks, documents, clients, billing_data, messages,
     subscriptions, guias_geradas, scheduled_notifications, audit_log
     RESTART IDENTITY CASCADE;`,
  );
  await testDb.insert(clients).values({
    id: CLIENT_ID,
    cnpj: "12345678000199",
    name: "ACME",
    passwordHash: "h",
    regularityStatus: "green",
  });
  serproPost.mockReset();
  loadDocumentPdfBuffer.mockReset().mockResolvedValue(null);
  extractDocNumberFromPdf.mockReset().mockResolvedValue(null);
});

// --- concurrency util --------------------------------------------------------

describe("mapWithConcurrency", () => {
  it("never runs more than `limit` tasks at once", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("keeps result order", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });
});

// --- interaction scheduling ------------------------------------------------

describe("recordGuiaInteraction", () => {
  it("creates one row and schedules a check for the next day", async () => {
    await seedGuia("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const r = await recordGuiaInteraction("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", CLIENT_ID, "copy_pix");

    expect(r.scheduled).toBe(true);
    const rows = await testDb.select().from(paymentChecks);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDENTE");
    expect(rows[0].nextCheckAt).toBeTruthy();
    expect(rows[0].nextCheckAt!.getTime()).toBeGreaterThan(Date.now());
    expect(rows[0].lastInteractionType).toBe("copy_pix");
  });

  it("repeated interactions do NOT create extra rows or move the schedule", async () => {
    await seedGuia("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    const first = await recordGuiaInteraction("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", CLIENT_ID, "view");
    await recordGuiaInteraction("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", CLIENT_ID, "copy_pix");
    await recordGuiaInteraction("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", CLIENT_ID, "copy_pix");

    const rows = await testDb.select().from(paymentChecks);
    expect(rows).toHaveLength(1);
    expect(rows[0].nextCheckAt!.getTime()).toBe(first.nextCheckAt!.getTime());
    expect(rows[0].lastInteractionType).toBe("copy_pix"); // last one wins
  });
});

// --- the sweeper ---------------------------------------------------------------

async function makeDueCheck(docId: string, over: Partial<typeof documents.$inferInsert> = {}) {
  await seedGuia(docId, over);
  await testDb.insert(paymentChecks).values({
    documentId: docId,
    clientId: CLIENT_ID,
    status: "PENDENTE",
    nextCheckAt: new Date(Date.now() - 60_000), // due
  });
}

describe("runPaymentQuerySweeper", () => {
  it("marks the guia (and the document) PAID when SERPRO confirms it", async () => {
    const docId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    await makeDueCheck(docId, { extractedData: { numeroDocumento: "07082207696788000" } });
    serproPost.mockResolvedValue(
      serproEnvelope([
        { numeroDocumento: "07082207696788000", dataArrecadacao: "2026-08-19", valorTotal: 123.45 },
      ]),
    );

    const res = await runPaymentQuerySweeper();
    expect(res.picked).toBe(1);
    expect(res.paid).toBe(1);

    const [check] = await testDb.select().from(paymentChecks).where(eq(paymentChecks.documentId, docId));
    expect(check.status).toBe("PAGO");
    expect(check.nextCheckAt).toBeNull();
    expect(check.paidSource).toBe("serpro");

    const [doc] = await testDb.select().from(documents).where(eq(documents.id, docId));
    expect(doc.status).toBe("paid");
  });

  it("reschedules and counts an attempt when the payment is not found", async () => {
    const docId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    await makeDueCheck(docId);
    serproPost.mockResolvedValue(serproEnvelope([]));

    await runPaymentQuerySweeper();
    const [check] = await testDb.select().from(paymentChecks).where(eq(paymentChecks.documentId, docId));
    expect(check.status).toBe("PENDENTE");
    expect(check.checkAttempts).toBe(1);
    expect(check.nextCheckAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not query a guia that is already PAGO", async () => {
    const docId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    await seedGuia(docId, { status: "paid" });
    await testDb.insert(paymentChecks).values({
      documentId: docId,
      clientId: CLIENT_ID,
      status: "PAGO",
      nextCheckAt: null,
    });

    const res = await runPaymentQuerySweeper();
    expect(res.picked).toBe(0);
    expect(serproPost).not.toHaveBeenCalled();
  });

  it("is idempotent — a second immediate run does nothing", async () => {
    const docId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    await makeDueCheck(docId);
    serproPost.mockResolvedValue(serproEnvelope([]));

    const first = await runPaymentQuerySweeper();
    expect(first.picked).toBe(1);
    const second = await runPaymentQuerySweeper();
    expect(second.picked).toBe(0);
  });
});

// --- accountant batch --------------------------------------------------------

describe("checkPaymentsForDocuments", () => {
  it("creates tracking rows and aggregates outcomes", async () => {
    const a = "10000000-0000-0000-0000-000000000001";
    const b = "10000000-0000-0000-0000-000000000002";
    await seedGuia(a, { extractedData: { numeroDocumento: "07082207696788000" } });
    await seedGuia(b, { category: "FGTS", title: "FGTS Digital" });

    serproPost.mockResolvedValue(
      serproEnvelope([{ numeroDocumento: "07082207696788000", dataArrecadacao: "2026-08-19" }]),
    );

    const result = await checkPaymentsForDocuments([a, b]);
    expect(result.selected).toBe(2);
    expect(result.paid).toBe(1); // only the federal DAS
    expect(result.notApplicable).toBe(1); // FGTS

    const rows = await testDb.select().from(paymentChecks);
    expect(rows).toHaveLength(2);
  });
});

// --- PAGTOWEB query modes ---------------------------------------------------

describe("consultarPagamentoNoSerpro", () => {
  const client = { cnpj: "12345678000199" };
  const baseDoc = {
    id: "20000000-0000-0000-0000-000000000001",
    category: "DAS_SIMPLES",
    title: "DAS — Simples Nacional",
    competence: "07/2026",
    dueDate: "2026-08-20",
  };

  it("queries by numeroDocumentoLista when the number is known", async () => {
    serproPost.mockResolvedValue(
      serproEnvelope([{ numeroDocumento: "07082207696788000", dataArrecadacao: "2026-08-19" }]),
    );

    const r = await consultarPagamentoNoSerpro(client, {
      ...baseDoc,
      extractedData: { numeroDocumento: "07082207696788000" },
    });

    expect(r.outcome).toBe("paid");
    expect(r.paidAt).toBe("2026-08-19");
    const sentDados = JSON.parse(serproPost.mock.calls[0][2].pedidoDados.dados);
    expect(sentDados.numeroDocumentoLista).toEqual(["07082207696788000"]);
    expect(sentDados.primeiroDaPagina).toBe(0);
    expect(sentDados.tamanhoDaPagina).toBe(100);
  });

  it("falls back to a date+value window and requires the amount to match", async () => {
    // Past due date so the arrecadação window is always valid regardless of clock.
    const oldDoc = { ...baseDoc, competence: "05/2020", dueDate: "2020-06-15" };
    serproPost.mockResolvedValue(
      serproEnvelope([{ dataArrecadacao: "2020-06-16", valorTotal: 500.0 }]),
    );

    const match = await consultarPagamentoNoSerpro(client, {
      ...oldDoc,
      extractedData: { extractedValue: 500 },
    });
    expect(match.outcome).toBe("paid");
    const dados = JSON.parse(serproPost.mock.calls[0][2].pedidoDados.dados);
    expect(dados.intervaloDataArrecadacao).toBeTruthy();
    expect(dados.numeroDocumentoLista).toBeUndefined();
    expect(dados.intervaloValorTotalDocumento).toEqual({ valorInicial: 499.5, valorFinal: 500.5 });

    serproPost.mockResolvedValue(
      serproEnvelope([{ dataArrecadacao: "2020-06-16", valorTotal: 999.0 }]),
    );
    const mismatch = await consultarPagamentoNoSerpro(client, {
      ...oldDoc,
      extractedData: { extractedValue: 500 },
    });
    expect(mismatch.outcome).toBe("not_found");
  });

  it("extracts the document number from the PDF once and caches it back", async () => {
    await seedGuia(baseDoc.id, { fileUrl: "/uploads/guia.pdf" });
    loadDocumentPdfBuffer.mockResolvedValue(Buffer.from("%PDF-1.4"));
    extractDocNumberFromPdf.mockResolvedValue("07082207696788000");
    serproPost.mockResolvedValue(
      serproEnvelope([{ numeroDocumento: "07082207696788000", dataArrecadacao: "2026-08-19" }]),
    );

    const [row] = await testDb.select().from(documents).where(eq(documents.id, baseDoc.id));
    const r = await consultarPagamentoNoSerpro(client, { ...baseDoc, fileUrl: row.fileUrl });

    expect(r.outcome).toBe("paid");
    expect(extractDocNumberFromPdf).toHaveBeenCalledTimes(1);
    const [after] = await testDb.select().from(documents).where(eq(documents.id, baseDoc.id));
    expect((after.extractedData as any).numeroDocumento).toBe("07082207696788000");
  });
});

// --- manual (accountant) mark-as-paid -------------------------------------

describe("markPaymentsManual", () => {
  it("marks selected guias paid without calling SERPRO or notifying", async () => {
    const a = "30000000-0000-0000-0000-000000000001";
    const b = "30000000-0000-0000-0000-000000000002";
    await seedGuia(a);
    await seedGuia(b);

    const r = await markPaymentsManual([a, b, a]);
    expect(r).toMatchObject({ selected: 2, marked: 2, skipped: 0 });
    expect(serproPost).not.toHaveBeenCalled();

    const checks = await testDb.select().from(paymentChecks);
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.status === "PAGO" && c.paidSource === "accountant")).toBe(true);

    const docs = await testDb.select().from(documents);
    expect(docs.every((d) => d.status === "paid")).toBe(true);
  });

  it("skips guias already PAGO", async () => {
    const a = "30000000-0000-0000-0000-000000000003";
    await seedGuia(a, { status: "paid" });
    await testDb.insert(paymentChecks).values({
      documentId: a,
      clientId: CLIENT_ID,
      status: "PAGO",
      nextCheckAt: null,
    });

    const r = await markPaymentsManual([a]);
    expect(r).toMatchObject({ selected: 1, marked: 0, skipped: 1 });
  });
});

describe("isFederalGuia", () => {
  it("accepts DAS/DARF/DCTFWEB, rejects FGTS/folha/no-due-date", () => {
    expect(isFederalGuia({ category: "DAS_SIMPLES", dueDate: "2026-08-20" })).toBe(true);
    expect(isFederalGuia({ category: "DCTFWEB_INSS", dueDate: "2026-08-20" })).toBe(true);
    expect(isFederalGuia({ category: "FGTS", dueDate: "2026-08-07" })).toBe(false);
    expect(isFederalGuia({ category: "contracheque", dueDate: "2026-08-05" })).toBe(false);
    expect(isFederalGuia({ category: "DAS_SIMPLES", dueDate: null })).toBe(false);
  });
});
