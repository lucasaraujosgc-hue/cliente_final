import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../../schema";
import { MODERN_PFX_B64, PFX_PASSWORD, LEAF_CNPJ } from "./fixtures/pfx";

// Emissão por procuração: o cliente não tem A1 — vale o certificado do
// escritório (o do Integra Contador, em serpro_config).
const pg = new PGlite();
const testDb = drizzle(pg, { schema });
vi.mock("../../../db", () => ({ db: testDb, pool: {} }));

const { loadClientCertContext, clearAgentCache } = await import("../cert");
const { clients, nfseConfig, serproConfig } = schema;

const CLIENT_ID = "44444444-4444-4444-4444-444444444444";
const DRIZZLE = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"));
const pfxPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nfse-proc-")), "escritorio.pfx");

beforeAll(async () => {
  for (const e of journal.entries) await pg.exec(fs.readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8"));
  fs.writeFileSync(pfxPath, Buffer.from(MODERN_PFX_B64, "base64")); // sem SECRETS_KEY no teste = arquivo em claro
}, 60_000);

beforeEach(async () => {
  clearAgentCache();
  await pg.exec(`TRUNCATE clients, nfse_config, serpro_config RESTART IDENTITY CASCADE;`);
  await testDb.insert(clients).values({ id: CLIENT_ID, cnpj: "11222333000181", name: "Cliente SA", passwordHash: "h", regularityStatus: "green" });
  await testDb.insert(nfseConfig).values({ clientId: CLIENT_ID, ativo: true, usarProcuracao: true });
});

describe("certificado por procuração", () => {
  it("usa o certificado do escritório (sem A1 do cliente)", async () => {
    await testDb.insert(serproConfig).values({ certPath: pfxPath, certSenha: PFX_PASSWORD });
    const ctx = await loadClientCertContext(CLIENT_ID);
    expect(ctx.procuracao).toBe(true);
    expect(ctx.parsed.cnpj).toBe(LEAF_CNPJ);
    expect(ctx.parsed.keyPem).toContain("PRIVATE KEY");
  });

  it("sem o certificado do escritório configurado, erro claro", async () => {
    await expect(loadClientCertContext(CLIENT_ID)).rejects.toMatchObject({ reason: "cert_missing" });
  });
});
