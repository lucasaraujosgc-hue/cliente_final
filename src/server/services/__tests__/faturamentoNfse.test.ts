import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../../schema";

const pg = new PGlite();
const testDb = drizzle(pg, { schema });
vi.mock("../../db", () => ({ db: testDb, pool: {} }));

const { aplicarFaturamentoNfse, upsertBilling } = await import("../billing");
const { clients, billingData, nfseEmissoes } = schema;

const CLIENT_ID = "55555555-5555-5555-5555-555555555555";
const DRIZZLE = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"));

beforeAll(async () => {
  for (const e of journal.entries) await pg.exec(fs.readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8"));
}, 60_000);

beforeEach(async () => {
  await pg.exec(`TRUNCATE clients, billing_data, nfse_emissoes RESTART IDENTITY CASCADE;`);
  await testDb.insert(clients).values({ id: CLIENT_ID, cnpj: "11222333000181", name: "Cliente", passwordHash: "h", regularityStatus: "green" });
});

const nota = (over: Partial<typeof nfseEmissoes.$inferInsert>) =>
  testDb.insert(nfseEmissoes).values({ clientId: CLIENT_ID, ambiente: "producao", status: "emitida", papel: "prestador", origem: "distribuicao", competencia: "09/2026", valorServicos: 10000, ...over } as any);
const mes = async (m: string) => (await testDb.select().from(billingData).where(eq(billingData.clientId, CLIENT_ID))).find((x) => x.month === m);

describe("faturamento a partir das NFS-e", () => {
  it("soma emitidas (serviços) e recebidas (tomados) por competência, em reais; ignora canceladas e homologação", async () => {
    await nota({ valorServicos: 150050 }); // R$ 1.500,50
    await nota({ valorServicos: 49950 }); // R$ 499,50
    await nota({ papel: "tomador", valorServicos: 30000 });
    await nota({ status: "cancelada", valorServicos: 999900 });
    await nota({ ambiente: "homologacao", valorServicos: 777700 });
    await nota({ competencia: "10/2026", valorServicos: 20000 });
    const r = await aplicarFaturamentoNfse(CLIENT_ID);
    expect(r.mesesAtualizados).toBe(2);
    expect(await mes("09/2026")).toMatchObject({ servicesRevenue: 2000, servicesTaken: 300, revenue: 2000, expenses: 300, servicesRevenueOrigem: "nfse", servicesTakenOrigem: "nfse" });
    expect(await mes("10/2026")).toMatchObject({ servicesRevenue: 200, servicesTaken: 0 });
  });

  it("não sobrescreve valor editado à mão; mercadorias e entradas ficam como estão", async () => {
    await upsertBilling(CLIENT_ID, { month: "09/2026", servicesRevenue: 5000, salesRevenue: 800, totalIncomes: 6000 });
    await nota({ valorServicos: 100000 });
    const r = await aplicarFaturamentoNfse(CLIENT_ID);
    expect(await mes("09/2026")).toMatchObject({ servicesRevenue: 5000, servicesRevenueOrigem: "manual", salesRevenue: 800, totalIncomes: 6000 });
    expect(r.mesesAtualizados).toBe(0);
  });

  it("reenviar o mesmo valor pelo formulário não tira a origem 'nfse'; mudar o valor vira 'manual'", async () => {
    await nota({ valorServicos: 100000 });
    await aplicarFaturamentoNfse(CLIENT_ID);
    await upsertBilling(CLIENT_ID, { month: "09/2026", servicesRevenue: 1000, salesRevenue: 50 });
    expect(await mes("09/2026")).toMatchObject({ servicesRevenueOrigem: "nfse", salesRevenue: 50 });
    await upsertBilling(CLIENT_ID, { month: "09/2026", servicesRevenue: 1200, salesRevenue: 50 });
    expect((await mes("09/2026"))?.servicesRevenueOrigem).toBe("manual");
  });

  it("valor informado antes (sem origem) e diferente das notas: mantém e reporta", async () => {
    await testDb.insert(billingData).values({ clientId: CLIENT_ID, month: "09/2026", servicesRevenue: 10000 });
    await nota({ valorServicos: 100000 });
    const r = await aplicarFaturamentoNfse(CLIENT_ID);
    expect((await mes("09/2026"))?.servicesRevenue).toBe(10000);
    expect(r.divergentes).toEqual([{ mes: "09/2026", campo: "servicos", informado: 10000, notas: 1000 }]);
  });

  it("nota cancelada depois: o mês que veio das notas volta para o novo total", async () => {
    await nota({ valorServicos: 100000 });
    await aplicarFaturamentoNfse(CLIENT_ID);
    await pg.exec(`UPDATE nfse_emissoes SET status = 'cancelada'`);
    await aplicarFaturamentoNfse(CLIENT_ID);
    expect((await mes("09/2026"))?.servicesRevenue).toBe(0);
  });
});
