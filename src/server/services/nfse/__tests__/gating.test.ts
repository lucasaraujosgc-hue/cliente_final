import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../../schema";

const pg = new PGlite();
const testDb = drizzle(pg, { schema });
vi.mock("../../../db", () => ({ db: testDb, pool: {} }));

const { nfseStatusForClient } = await import("../status");
const { clients, nfseConfig, nfseAtividades } = schema;

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

const DRIZZLE = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"));
const migrationSqls: string[] = journal.entries.map((e: { tag: string }) =>
  fs.readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8"),
);

beforeAll(async () => {
  for (const sql of migrationSqls) await pg.exec(sql);
}, 60_000);

beforeEach(async () => {
  await pg.exec(
    `TRUNCATE clients, nfse_config, nfse_atividades, nfse_emissoes RESTART IDENTITY CASCADE;`,
  );
  await testDb.insert(clients).values({
    id: CLIENT_ID,
    cnpj: "12345678000199",
    name: "ACME",
    passwordHash: "h",
    regularityStatus: "green",
  });
});

async function addConfig(over: Partial<typeof nfseConfig.$inferInsert> = {}) {
  await testDb.insert(nfseConfig).values({ clientId: CLIENT_ID, ...over });
}
async function addAtividade(over: Partial<typeof nfseAtividades.$inferInsert> = {}) {
  await testDb.insert(nfseAtividades).values({
    clientId: CLIENT_ID,
    nome: "Consulta",
    itemListaServico: "4.16",
    ...over,
  });
}

describe("nfseStatusForClient — gating", () => {
  it("sem_config when there is no config row", async () => {
    const s = await nfseStatusForClient(CLIENT_ID);
    expect(s.enabled).toBe(false);
    expect(s.motivo).toBe("sem_config");
    expect(s.message).toMatch(/novembro\/2026/);
  });

  it("sem_certificado when a config exists but no cert", async () => {
    await addConfig({ ativo: true });
    await addAtividade();
    const s = await nfseStatusForClient(CLIENT_ID);
    expect(s.enabled).toBe(false);
    expect(s.motivo).toBe("sem_certificado");
  });

  it("inativo when cert present but the switch is off", async () => {
    await addConfig({ ativo: false, certPath: "/x/cert.pfx" });
    await addAtividade();
    const s = await nfseStatusForClient(CLIENT_ID);
    expect(s.enabled).toBe(false);
    expect(s.motivo).toBe("inativo");
  });

  it("sem_atividade when active + cert but no active activity", async () => {
    await addConfig({ ativo: true, certPath: "/x/cert.pfx" });
    await addAtividade({ ativo: false });
    const s = await nfseStatusForClient(CLIENT_ID);
    expect(s.enabled).toBe(false);
    expect(s.motivo).toBe("sem_atividade");
  });

  it("enabled when cert + active switch + at least one active activity", async () => {
    await addConfig({ ativo: true, certPath: "/x/cert.pfx", codigoMunicipio: "3550308", ambiente: "producao" });
    await addAtividade({ ativo: true });
    const s = await nfseStatusForClient(CLIENT_ID);
    expect(s.enabled).toBe(true);
    expect(s.ambiente).toBe("producao");
    expect(s.codigoMunicipio).toBe("3550308");
    expect(s.message).toBe("");
  });
});
