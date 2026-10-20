import fs from "fs";
import path from "path";
import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "../../db";
import { clients, fiscalSitfis } from "../../schema";
import { chamarIntegra, LimiteSerproError } from "./integra";
import { extrairLinhasPdf, lerSitfis, VERSAO_LEITOR, type SitfisResultado } from "./sitfisParser";

// Relatório de Situação Fiscal pelo Integra Contador (Integra-SITFIS):
//   1. SOLICITARPROTOCOLO91 (rota Apoiar, versão 2.0) → protocoloRelatorio +
//      tempoEspera (ms). 304 = já existe protocolo do dia (vem no ETag).
//   2. RELATORIOSITFIS92 (rota Emitir, versão 2.0) → dados.pdf (base64) com 200,
//      ou 202 + tempoEspera enquanto o relatório é gerado.
// Custo: 2 chamadas por cliente (+1 por nova tentativa enquanto der 202).

export const SITFIS_PDF_DIR = process.env.DATA_PATH
  ? path.join(process.env.DATA_PATH, "sitfis_pdfs")
  : path.join(process.cwd(), "data", "sitfis_pdfs");

/** Caminho gravado em fiscal_sitfis.pdf_path → caminho absoluto dentro da pasta, ou null. */
export function resolverPdfSitfis(pdfPath: string | null | undefined): string | null {
  if (!pdfPath) return null;
  const abs = path.resolve(pdfPath);
  const rel = path.relative(path.resolve(SITFIS_PDF_DIR), abs);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? abs : null;
}

const MAX_TENTATIVAS_EMITIR = 3;
const MANTER_PDF_DIAS = 120;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const somenteDigitos = (v: string) => String(v || "").replace(/\D/g, "");

// tempoEspera documentado em ms na solicitação; no 202 do emitir a unidade não
// é informada — valor pequeno é tratado como segundos.
function tempoEsperaMs(v: unknown, padrao = 3000): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return padrao;
  const ms = n < 300 ? n * 1000 : n;
  return Math.min(Math.max(ms, 1500), 60_000);
}

function log(evento: string, campos: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), scope: "fiscal", evento, ...campos }));
}

export interface EmissaoSitfis {
  ok: boolean;
  erro?: string;
  semProcuracao?: boolean;
  resultado?: SitfisResultado;
  id?: number;
}

async function registrar(clientId: string, origem: string, v: Partial<typeof fiscalSitfis.$inferInsert>): Promise<number> {
  const [row] = await db
    .insert(fiscalSitfis)
    .values({ clientId, origem, ok: false, ...v })
    .returning({ id: fiscalSitfis.id });
  return row.id;
}

export async function emitirSitfis(clientId: string, origem: "automatico" | "manual"): Promise<EmissaoSitfis> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return { ok: false, erro: "Cliente não encontrado." };
  const cnpj = somenteDigitos(client.cnpj);
  if (cnpj.length !== 14) return { ok: false, erro: "CNPJ inválido no cadastro do cliente." };

  const falhar = async (erro: string, semProcuracao = false): Promise<EmissaoSitfis> => {
    log("sitfis.falhou", { clientId, erro: erro.slice(0, 500) });
    const id = await registrar(clientId, origem, { ok: false, erro: semProcuracao ? `Sem procuração: ${erro}` : erro });
    return { ok: false, erro, semProcuracao, id };
  };

  try {
    const sol = await chamarIntegra({
      rota: "Apoiar",
      idSistema: "SITFIS",
      idServico: "SOLICITARPROTOCOLO91",
      versaoSistema: "2.0",
      contribuinte: { numero: cnpj, tipo: 2 },
      dados: "",
      clientId,
      origem,
    });
    // No 304 o protocolo vem no ETag — às vezes como "protocoloRelatorio:<valor>".
    const etag = String(sol.headers?.etag ?? "")
      .replace(/^W\//, "")
      .replace(/"/g, "")
      .replace(/^.*protocoloRelatorio\s*[:=]\s*/i, "")
      .trim();
    const protocolo = sol.dados?.protocoloRelatorio || (sol.httpStatus === 304 ? etag : "");
    if (!protocolo) {
      const msg = sol.mensagens.map((m) => `${m.codigo || ""} ${m.texto || ""}`.trim()).join(" · ") || `HTTP ${sol.httpStatus}`;
      return falhar(`Solicitação do relatório recusada: ${msg}`, sol.semProcuracao);
    }

    let aguardar = tempoEsperaMs(sol.dados?.tempoEspera);
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_EMITIR; tentativa++) {
      await espera(aguardar);
      const r = await chamarIntegra({
        rota: "Emitir",
        idSistema: "SITFIS",
        idServico: "RELATORIOSITFIS92",
        versaoSistema: "2.0",
        contribuinte: { numero: cnpj, tipo: 2 },
        dados: { protocoloRelatorio: protocolo },
        clientId,
        origem,
      });
      const pdf64 = r.dados?.pdf;
      if (r.httpStatus === 200 && pdf64) {
        const buffer = Buffer.from(String(pdf64), "base64");
        await fs.promises.mkdir(SITFIS_PDF_DIR, { recursive: true });
        const arquivo = path.join(SITFIS_PDF_DIR, `sitfis_${clientId}_${Date.now()}.pdf`);
        await fs.promises.writeFile(arquivo, buffer);
        let resultado: SitfisResultado | undefined;
        let erroLeitura: string | undefined;
        try {
          resultado = lerSitfis(await extrairLinhasPdf(buffer));
        } catch (e) {
          erroLeitura = `Relatório emitido, mas não foi possível ler o PDF: ${e instanceof Error ? e.message : String(e)}`;
          log("sitfis.leitura_falhou", { clientId, msg: erroLeitura });
        }
        const id = await registrar(clientId, origem, { ok: true, pdfPath: arquivo, resultado: (resultado ?? null) as any, erro: erroLeitura ?? null });
        log("sitfis.ok", { clientId, secoes: resultado?.secoes.length ?? null, semPendencias: resultado?.semPendencias ?? null });
        void limparAntigos(clientId);
        return { ok: true, resultado, id };
      }
      if (r.httpStatus === 202) {
        aguardar = tempoEsperaMs(r.dados?.tempoEspera, 5000);
        continue;
      }
      const msg = r.mensagens.map((m) => `${m.codigo || ""} ${m.texto || ""}`.trim()).join(" · ") || `HTTP ${r.httpStatus}`;
      return falhar(`Emissão do relatório recusada: ${msg}`, r.semProcuracao);
    }
    return falhar("O SERPRO não terminou de gerar o relatório a tempo. Tente de novo mais tarde.");
  } catch (e) {
    if (e instanceof LimiteSerproError) throw e;
    return falhar(e instanceof Error ? e.message : String(e));
  }
}

export async function ultimoSitfis(clientId: string) {
  const [r] = await db
    .select()
    .from(fiscalSitfis)
    .where(eq(fiscalSitfis.clientId, clientId))
    .orderBy(desc(fiscalSitfis.createdAt))
    .limit(1);
  return r ?? null;
}

/** Último relatório emitido com sucesso (o que vale para o painel). */
export async function ultimoSitfisOk(clientId: string) {
  const [r] = await db
    .select()
    .from(fiscalSitfis)
    .where(and(eq(fiscalSitfis.clientId, clientId), eq(fiscalSitfis.ok, true)))
    .orderBy(desc(fiscalSitfis.createdAt))
    .limit(1);
  return r ?? null;
}

/**
 * Relê com o leitor atual os relatórios lidos por uma versão anterior (o PDF
 * fica em disco) — sem SERPRO. Devolve os clientes cujo relatório mudou.
 */
export async function relerDesatualizados(): Promise<string[]> {
  const rows = await db
    .select({ id: fiscalSitfis.id, clientId: fiscalSitfis.clientId, pdfPath: fiscalSitfis.pdfPath, resultado: fiscalSitfis.resultado })
    .from(fiscalSitfis)
    .where(and(eq(fiscalSitfis.ok, true), isNotNull(fiscalSitfis.pdfPath)));
  const afetados = new Set<string>();
  for (const r of rows) {
    if (Number((r.resultado as { versao?: number } | null)?.versao) >= VERSAO_LEITOR) continue;
    const abs = resolverPdfSitfis(r.pdfPath);
    if (!abs) continue;
    try {
      const resultado = lerSitfis(await extrairLinhasPdf(await fs.promises.readFile(abs)));
      await db.update(fiscalSitfis).set({ resultado: resultado as any, erro: null }).where(eq(fiscalSitfis.id, r.id));
      afetados.add(r.clientId);
    } catch (e) {
      log("sitfis.reler_erro", { id: r.id, msg: e instanceof Error ? e.message : String(e) });
    }
  }
  if (afetados.size) log("sitfis.relidos", { clientes: afetados.size, versao: VERSAO_LEITOR });
  return [...afetados];
}

// PDFs com mais de 120 dias saem do disco (o registro fica, sem o arquivo).
async function limparAntigos(clientId: string) {
  try {
    const limite = new Date(Date.now() - MANTER_PDF_DIAS * 86_400_000);
    const antigos = await db
      .select({ id: fiscalSitfis.id, pdfPath: fiscalSitfis.pdfPath })
      .from(fiscalSitfis)
      .where(and(eq(fiscalSitfis.clientId, clientId), lt(fiscalSitfis.createdAt, limite)));
    for (const a of antigos) {
      if (a.pdfPath) await fs.promises.unlink(a.pdfPath).catch(() => {});
      await db.update(fiscalSitfis).set({ pdfPath: null }).where(eq(fiscalSitfis.id, a.id));
    }
  } catch {
    /* limpeza é oportunista */
  }
}
