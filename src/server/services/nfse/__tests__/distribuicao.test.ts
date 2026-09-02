import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "../../../schema";

const pg = new PGlite();
const testDb = drizzle(pg, { schema });
vi.mock("../../../db", () => ({ db: testDb, pool: {} }));

const cert = { config: { ambiente: "homologacao", certCnpj: "52613515000160" }, agent: {}, parsed: {} };
vi.mock("../cert", () => ({ loadClientCertContext: async () => cert }));

const distribuir = vi.fn();
vi.mock("../client", () => ({ distribuirDFe: (...a: any[]) => distribuir(...a) }));

const { sincronizarDistribuicao } = await import("../distribuicao");
const { clients, nfseConfig, nfseEmissoes } = schema;

const CLIENT_ID = "33333333-3333-3333-3333-333333333333";
const CHAVE_A = "29293052" + "12345678000199" + "0".repeat(28);
const CHAVE_B = "29293052" + "98765432000100" + "0".repeat(28);

const DRIZZLE = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"));

function nfseXml(chave: string, n: string, vServ: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${chave}"><nNFSe>${n}</nNFSe><cStat>100</cStat><dhProc>2026-09-01T10:00:00-03:00</dhProc><emit><CNPJ>52613515000160</CNPJ></emit><toma><CNPJ>07252858000192</CNPJ><xNome>Tomador X</xNome></toma><serv><cServ><xDescServ>Serviço</xDescServ></cServ></serv><valores><vServPrest><vServ>${vServ}</vServ></vServPrest><dCompet>2026-09-01</dCompet></valores></infNFSe></NFSe>`;
}

beforeAll(async () => {
  for (const e of journal.entries) {
    await pg.exec(fs.readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8"));
  }
}, 60_000);

beforeEach(async () => {
  distribuir.mockReset();
  await pg.exec(`TRUNCATE clients, nfse_config, nfse_atividades, nfse_emissoes RESTART IDENTITY CASCADE;`);
  await testDb.insert(clients).values({
    id: CLIENT_ID,
    cnpj: "52613515000160",
    name: "VIRGULA CONTABIL LTDA",
    passwordHash: "h",
    regularityStatus: "green",
  });
  await testDb.insert(nfseConfig).values({
    clientId: CLIENT_ID,
    ativo: true,
    ambiente: "homologacao",
    certPath: "/x/c.pfx",
    codigoMunicipio: "2929305",
  });
});

describe("sincronizarDistribuicao", () => {
  it("insere NFS-e recebidas do portal com origem='distribuicao' e avança o NSU", async () => {
    distribuir.mockResolvedValueOnce({
      status: "DOCUMENTOS_LOCALIZADOS",
      docs: [
        { nsu: 10, chaveAcesso: CHAVE_A, tipoDocumento: "NFSE", tipoEvento: null, xml: nfseXml(CHAVE_A, "5", "100.00"), dataHoraGeracao: "2026-09-01T10:00:00-03:00" },
        { nsu: 11, chaveAcesso: CHAVE_B, tipoDocumento: "NFSE", tipoEvento: null, xml: nfseXml(CHAVE_B, "6", "250.00"), dataHoraGeracao: null },
      ],
      ultimoNsu: 11,
      alertas: [],
      erros: [],
      raw: {},
    });
    distribuir.mockResolvedValueOnce({ status: "NENHUM_DOCUMENTO_LOCALIZADO", docs: [], ultimoNsu: 11, alertas: [], erros: [], raw: {} });

    const r = await sincronizarDistribuicao(CLIENT_ID);
    expect(r.novas).toBe(2);
    expect(r.ultimoNsu).toBe(11);

    const rows = await testDb.select().from(nfseEmissoes).where(eq(nfseEmissoes.clientId, CLIENT_ID));
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.origem === "distribuicao" && x.status === "emitida")).toBe(true);
    const a = rows.find((x) => x.chaveAcesso === CHAVE_A)!;
    expect(a.valorServicos).toBe(10000);
    expect(a.numeroNota).toBe("5");

    const [cfg] = await testDb.select().from(nfseConfig).where(eq(nfseConfig.clientId, CLIENT_ID));
    expect(cfg.ultimoNsu).toBe(11);
  });

  it("não duplica uma NFS-e já emitida por aqui — só amarra o NSU", async () => {
    await testDb.insert(nfseEmissoes).values({
      clientId: CLIENT_ID,
      status: "emitida",
      origem: "sistema",
      chaveAcesso: CHAVE_A,
      numeroNota: "5",
    });
    distribuir.mockResolvedValueOnce({
      status: "DOCUMENTOS_LOCALIZADOS",
      docs: [{ nsu: 20, chaveAcesso: CHAVE_A, tipoDocumento: "NFSE", tipoEvento: null, xml: nfseXml(CHAVE_A, "5", "100.00"), dataHoraGeracao: null }],
      ultimoNsu: 20,
      alertas: [],
      erros: [],
      raw: {},
    });
    distribuir.mockResolvedValueOnce({ status: "NENHUM_DOCUMENTO_LOCALIZADO", docs: [], ultimoNsu: 20, alertas: [], erros: [], raw: {} });

    const r = await sincronizarDistribuicao(CLIENT_ID);
    expect(r.novas).toBe(0);
    expect(r.atualizadas).toBe(1);
    const rows = await testDb.select().from(nfseEmissoes).where(eq(nfseEmissoes.clientId, CLIENT_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0].origem).toBe("sistema");
    expect(rows[0].nsu).toBe(20);
  });

  it("evento de cancelamento marca a nota como cancelada", async () => {
    await testDb.insert(nfseEmissoes).values({
      clientId: CLIENT_ID,
      status: "emitida",
      origem: "sistema",
      chaveAcesso: CHAVE_A,
    });
    distribuir.mockResolvedValueOnce({
      status: "DOCUMENTOS_LOCALIZADOS",
      docs: [{ nsu: 30, chaveAcesso: CHAVE_A, tipoDocumento: "EVENTO", tipoEvento: "CANCELAMENTO", xml: "<evento/>", dataHoraGeracao: "2026-09-02T09:00:00-03:00" }],
      ultimoNsu: 30,
      alertas: [],
      erros: [],
      raw: {},
    });
    distribuir.mockResolvedValueOnce({ status: "NENHUM_DOCUMENTO_LOCALIZADO", docs: [], ultimoNsu: 30, alertas: [], erros: [], raw: {} });

    const r = await sincronizarDistribuicao(CLIENT_ID);
    expect(r.eventos).toBe(1);
    const [row] = await testDb.select().from(nfseEmissoes).where(and(eq(nfseEmissoes.clientId, CLIENT_ID), eq(nfseEmissoes.chaveAcesso, CHAVE_A)));
    expect(row.status).toBe("cancelada");
  });
});
