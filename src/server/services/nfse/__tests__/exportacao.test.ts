import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../../schema";

const pg = new PGlite();
const testDb = drizzle(pg, { schema });
vi.mock("../../../db", () => ({ db: testDb, pool: {} }));

const { resumoXml, zipXmlCliente, mesDaNota } = await import("../exportacao");
const { clients, nfseEmissoes } = schema;

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const DRIZZLE = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"));

const nota = (o: Partial<typeof nfseEmissoes.$inferInsert>) => ({
  clientId: A,
  status: "emitida",
  papel: "prestador",
  origem: "distribuicao",
  ambiente: "producao",
  xmlNfse: `<NFSe><infNFSe Id="NFS${o.chaveAcesso}"/></NFSe>`,
  ...o,
});

beforeAll(async () => {
  for (const e of journal.entries) await pg.exec(fs.readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8"));
}, 60_000);

beforeEach(async () => {
  await pg.exec("TRUNCATE clients, nfse_emissoes RESTART IDENTITY CASCADE;");
  await testDb.insert(clients).values([
    { id: A, cnpj: "11222333000181", name: "Clínica Ação LTDA", passwordHash: "h", regularityStatus: "green" },
    { id: B, cnpj: "12345678000195", name: "Sem Notas", passwordHash: "h", regularityStatus: "green" },
  ]);
  await testDb.insert(nfseEmissoes).values([
    nota({ competencia: "10/2026", numeroNota: "1", chaveAcesso: "C1" }),
    nota({ competencia: "11/2026", numeroNota: "2", chaveAcesso: "C2", status: "cancelada" }),
    nota({ competencia: "11/2026", papel: "tomador", numeroNota: "77", chaveAcesso: "T1" }),
    nota({ competencia: "11/2026", numeroNota: "3", chaveAcesso: "H1", ambiente: "homologacao" }), // sem valor fiscal
    nota({ competencia: "11/2026", numeroNota: "4", chaveAcesso: "R1", status: "rejeitada" }),
    nota({ competencia: "09/2026", numeroNota: "0", chaveAcesso: "C0" }), // fora do período
    nota({ competencia: null, dataEmissao: new Date("2026-11-01T01:00:00Z"), numeroNota: "5", chaveAcesso: "C5" }), // 31/10 em Brasília
  ]);
});

describe("exportação dos XML", () => {
  it("mês da nota: competência gravada ou a data de emissão em Brasília", () => {
    expect(mesDaNota({ competencia: "11/2026", dataEmissao: null, createdAt: new Date() })).toBe("2026-11");
    expect(mesDaNota({ competencia: null, dataEmissao: new Date("2026-11-01T01:00:00Z"), createdAt: new Date() })).toBe("2026-10");
  });

  it("resumo conta só produção, emitidas/canceladas e o período", async () => {
    expect(await resumoXml("2026-10", "2026-11")).toEqual([
      { clientId: A, nome: "Clínica Ação LTDA", cnpj: "11222333000181", prestados: 3, tomados: 1, canceladas: 1 },
    ]);
    expect(await resumoXml("2026-12", "2026-12")).toEqual([]);
  });

  it("zip separa Prestados e Tomados, com as canceladas à parte", async () => {
    const z = (await zipXmlCliente(A, "2026-10", "2026-11", ["prestados", "tomados"]))!;
    expect(z.arquivo).toBe("XML NFS-e - Clinica Acao LTDA - 11222333000181 - 10-2026 a 11-2026.zip");
    expect(z).toMatchObject({ prestados: 3, tomados: 1 });
    const zip = await JSZip.loadAsync(z.bytes);
    const arquivos = Object.keys(zip.files).filter((f) => !zip.files[f].dir).sort();
    expect(arquivos).toEqual([
      "Prestados/Canceladas/NFS-e 2 - C2.xml",
      "Prestados/NFS-e 1 - C1.xml",
      "Prestados/NFS-e 5 - C5.xml",
      "Tomados/NFS-e 77 - T1.xml",
    ]);
    expect(await zip.file("Tomados/NFS-e 77 - T1.xml")!.async("string")).toContain('Id="NFST1"');
  });

  it("só os tipos pedidos; sem nota no período, nada", async () => {
    const z = (await zipXmlCliente(A, "2026-11", "2026-11", ["tomados"]))!;
    expect(z).toMatchObject({ prestados: 0, tomados: 1 });
    expect(z.arquivo).toMatch(/ - 11-2026\.zip$/);
    expect(await zipXmlCliente(B, "2026-01", "2026-12", ["prestados", "tomados"])).toBeNull();
  });
});
