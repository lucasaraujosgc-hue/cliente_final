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

// Assinatura e validação estrutural têm testes próprios — aqui só a orquestração.
vi.mock("../sign", () => ({
  signDps: (xml: string) => xml.replace("</infDPS>", "</infDPS><Signature>x</Signature>"),
}));
vi.mock("../validate", () => ({ validateDps: () => {}, validatePedRegEvento: () => {} }));
vi.mock("../params", () => ({
  getConvenio: async () => ({ aderente: false, raw: null }),
  getAliquotaParametrizada: async () => null,
}));

const cert = { config: { ambiente: "homologacao" }, agent: {}, parsed: { keyPem: "k", certPem: "c", cnpj: "12345678000199" } };
vi.mock("../cert", () => ({ loadClientCertContext: async () => cert }));

const postNfse = vi.fn();
const headDps = vi.fn(async (..._a: any[]) => false);
const consultarDps = vi.fn(async (..._a: any[]) => null);
const consultarNfse = vi.fn(async (..._a: any[]) => null);
vi.mock("../client", () => ({
  emitirNfse: (...a: any[]) => postNfse(...a),
  headDps: (...a: any[]) => headDps(...a),
  consultarDps: (...a: any[]) => consultarDps(...a),
  consultarNfse: (...a: any[]) => consultarNfse(...a),
}));

const { emitirNfse } = await import("../emitir");
const { clients, nfseConfig, nfseAtividades, nfseEmissoes } = schema;

const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const DRIZZLE = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"));

const CHAVE = "35503082212345678000199000000000004226081234567895";
const NFSE_XML = `<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infNFSe Id="NFS${CHAVE}"><nNFSe>42</nNFSe><cStat>100</cStat></infNFSe></NFSe>`;

function okResult(over: Record<string, unknown> = {}) {
  return {
    status: 201,
    chaveAcesso: CHAVE,
    idDps: "",
    nfseXml: NFSE_XML,
    alertas: [],
    versaoAplicativo: "SN-1",
    processadoEm: "2026-08-31T09:50:49-03:00",
    raw: {},
    ...over,
  };
}

const input = {
  atividadeId: "",
  tomador: { doc: "98765432000110", nome: "Tomadora SA" },
  descricao: "Serviço de teste",
  valor: 25000,
  competencia: "08/2026",
};

let atividadeId = "";

beforeAll(async () => {
  for (const e of journal.entries) {
    await pg.exec(fs.readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8"));
  }
}, 60_000);

beforeEach(async () => {
  postNfse.mockReset();
  headDps.mockReset();
  headDps.mockResolvedValue(false);
  await pg.exec(`TRUNCATE clients, nfse_config, nfse_atividades, nfse_emissoes RESTART IDENTITY CASCADE;`);
  await testDb.insert(clients).values({
    id: CLIENT_ID,
    cnpj: "12345678000199",
    name: "ACME LTDA",
    passwordHash: "h",
    regularityStatus: "green",
  });
  await testDb.insert(nfseConfig).values({
    clientId: CLIENT_ID,
    ativo: true,
    ambiente: "homologacao",
    certPath: "/x/cert.pfx",
    codigoMunicipio: "3550308",
    regimeTributario: "simples_nacional",
    serieDps: "00001",
  });
  const [atv] = await testDb
    .insert(nfseAtividades)
    .values({
      clientId: CLIENT_ID,
      nome: "Consulta",
      itemListaServico: "4.16",
      codTributacaoNac: "040160",
      aliquotaIss: 2,
    })
    .returning();
  atividadeId = atv.id;
  input.atividadeId = atividadeId;
});

describe("emitirNfse — orquestração", () => {
  it("201 com NFS-e utilizável → linha 'emitida' com a chave", async () => {
    postNfse.mockResolvedValueOnce(okResult());
    const row = await emitirNfse(CLIENT_ID, input);
    expect(row.status).toBe("emitida");
    expect(row.chaveAcesso).toBe(CHAVE);
    expect(row.numeroNota).toBe("42");
    expect(row.versaoAplicativo).toBe("SN-1");
  });

  it("rejeição de regra de negócio (422) → linha 'rejeitada' e lança", async () => {
    postNfse.mockRejectedValueOnce(
      new NfseError("Serviço inválido para o município.", { status: 422, reason: "rejeitada", codigo: "E1234" }),
    );
    await expect(emitirNfse(CLIENT_ID, input)).rejects.toThrow(/Serviço inválido/);
    const [row] = await testDb.select().from(nfseEmissoes).where(eq(nfseEmissoes.clientId, CLIENT_ID));
    expect(row.status).toBe("rejeitada");
    expect(row.rejeicaoCodigo).toBe("E1234");
  });

  it("HTTP 500 / indisponibilidade → linha 'processando' e lança 202", async () => {
    postNfse.mockRejectedValueOnce(
      new NfseError("Falha no processamento.", { status: 502, reason: "sefin_indisponivel" }),
    );
    await expect(emitirNfse(CLIENT_ID, input)).rejects.toMatchObject({ status: 202, reason: "processando" });
    const [row] = await testDb.select().from(nfseEmissoes).where(eq(nfseEmissoes.clientId, CLIENT_ID));
    expect(row.status).toBe("processando");
    expect(row.idDps).toMatch(/^DPS/);
  });

  it("201 sem NFS-e no corpo → 'processando' (anomalia), sem lançar", async () => {
    postNfse.mockResolvedValueOnce(okResult({ nfseXml: "", chaveAcesso: "" }));
    const row = await emitirNfse(CLIENT_ID, input);
    expect(row.status).toBe("processando");
  });

  it("dedupe: reenvio idêntico enquanto há 'processando' não gera 2ª nota", async () => {
    postNfse.mockRejectedValueOnce(
      new NfseError("timeout", { status: 502, reason: "sefin_indisponivel" }),
    );
    await expect(emitirNfse(CLIENT_ID, input)).rejects.toMatchObject({ reason: "processando" });

    // 2ª tentativa: reconcilia a pendente (headDps=false → segue processando) e barra
    await expect(emitirNfse(CLIENT_ID, input)).rejects.toMatchObject({ status: 409, reason: "processando" });
    const rows = await testDb.select().from(nfseEmissoes).where(eq(nfseEmissoes.clientId, CLIENT_ID));
    expect(rows).toHaveLength(1);
    expect(postNfse).toHaveBeenCalledTimes(1);
  });

  it("CNPJ do tomador alfanumérico é preservado como string", async () => {
    postNfse.mockResolvedValueOnce(okResult());
    const row = await emitirNfse(CLIENT_ID, { ...input, tomador: { doc: "12ABC678000D99", nome: "Alfa SA" } });
    expect(row.tomadorDoc).toBe("12ABC678000D99");
  });
});
