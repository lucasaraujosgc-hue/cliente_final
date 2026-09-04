import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../../../schema";
import { NfseError } from "../errors";

const pg = new PGlite();
const testDb = drizzle(pg, { schema });
vi.mock("../../../db", () => ({ db: testDb, pool: {} }));

const { excluirEmissao, excluirEmissoesDescartaveis } = await import("../emissoes");
const { clients, nfseEmissoes } = schema;

const CLIENT_ID = "44444444-4444-4444-4444-444444444444";
const OUTRO = "55555555-5555-5555-5555-555555555555";
const DRIZZLE = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"));

beforeAll(async () => {
  for (const e of journal.entries) {
    await pg.exec(fs.readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8"));
  }
}, 60_000);

beforeEach(async () => {
  await pg.exec(`TRUNCATE clients, nfse_emissoes RESTART IDENTITY CASCADE;`);
  const cnpjs: Record<string, string> = { [CLIENT_ID]: "12345678000199", [OUTRO]: "98765432000100" };
  for (const id of [CLIENT_ID, OUTRO]) {
    await testDb.insert(clients).values({
      id,
      cnpj: cnpjs[id],
      name: "C",
      passwordHash: "h",
      regularityStatus: "green",
    });
  }
});

async function novaEmissao(status: string, clientId = CLIENT_ID) {
  const [row] = await testDb
    .insert(nfseEmissoes)
    .values({ clientId, status, origem: "sistema" })
    .returning();
  return row;
}

describe("excluirEmissao", () => {
  it("apaga uma emissão rejeitada", async () => {
    const row = await novaEmissao("rejeitada");
    await excluirEmissao(row.id, { clientId: CLIENT_ID });
    const rest = await testDb.select().from(nfseEmissoes).where(eq(nfseEmissoes.id, row.id));
    expect(rest).toHaveLength(0);
  });

  it("recusa apagar uma nota emitida", async () => {
    const row = await novaEmissao("emitida");
    await expect(excluirEmissao(row.id, { clientId: CLIENT_ID })).rejects.toMatchObject({
      status: 409,
    });
    const rest = await testDb.select().from(nfseEmissoes).where(eq(nfseEmissoes.id, row.id));
    expect(rest).toHaveLength(1);
  });

  it("recusa apagar 'processando' e 'cancelada'", async () => {
    for (const st of ["processando", "cancelada"]) {
      const row = await novaEmissao(st);
      await expect(excluirEmissao(row.id, { clientId: CLIENT_ID })).rejects.toBeInstanceOf(NfseError);
    }
  });

  it("não deixa um cliente apagar a emissão de outro", async () => {
    const row = await novaEmissao("rejeitada", OUTRO);
    await expect(excluirEmissao(row.id, { clientId: CLIENT_ID })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("sem clientId (admin) apaga qualquer rejeitada", async () => {
    const row = await novaEmissao("rejeitada", OUTRO);
    await excluirEmissao(row.id);
    const rest = await testDb.select().from(nfseEmissoes).where(eq(nfseEmissoes.id, row.id));
    expect(rest).toHaveLength(0);
  });
});

describe("excluirEmissoesDescartaveis", () => {
  it("apaga só as rejeitadas do cliente e devolve a contagem", async () => {
    await novaEmissao("rejeitada");
    await novaEmissao("rejeitada");
    await novaEmissao("emitida");
    await novaEmissao("rejeitada", OUTRO);

    const n = await excluirEmissoesDescartaveis(CLIENT_ID);
    expect(n).toBe(2);

    const meus = await testDb.select().from(nfseEmissoes).where(eq(nfseEmissoes.clientId, CLIENT_ID));
    expect(meus.map((r) => r.status)).toEqual(["emitida"]);
    const outro = await testDb.select().from(nfseEmissoes).where(eq(nfseEmissoes.clientId, OUTRO));
    expect(outro).toHaveLength(1);
  });
});
