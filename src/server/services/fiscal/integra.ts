import { and, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import { serproUso } from "../../schema";
import { buildSerproContext, getSerproToken, serproPost } from "../serpro";

// Chamadas do painel fiscal ao Integra Contador. Toda chamada passa por aqui
// para: (1) respeitar o limite mensal (FISCAL_SERPRO_LIMITE_MES), (2) ficar
// registrada em serpro_uso — é o que o painel mostra como consumo do mês.

export const LIMITE_MES = Number(process.env.FISCAL_SERPRO_LIMITE_MES) || 800;

export type Rota = "Consultar" | "Monitorar" | "Emitir" | "Apoiar";

export interface ChamadaIntegra {
  rota: Rota;
  idSistema: string;
  idServico: string;
  contribuinte: { numero: string; tipo: number }; // tipo 2 = CNPJ, 4 = lista de CNPJs
  dados: Record<string, unknown> | "";
  versaoSistema?: string; // padrão "1.0" (o SITFIS é "2.0")
  clientId?: string | null;
  origem: "automatico" | "manual";
}

export interface RespostaIntegra {
  ok: boolean;
  httpStatus: number;
  mensagens: { codigo?: string; texto?: string }[];
  dados: any; // JSON já interpretado (o SERPRO manda string escapada)
  headers: Record<string, string | string[] | undefined>;
  semProcuracao: boolean;
  texto: string; // corpo cru, para log
}

export class LimiteSerproError extends Error {
  status = 429;
  constructor(usado: number) {
    super(`Limite mensal de consultas ao Integra Contador atingido (${usado}/${LIMITE_MES}). Aumente FISCAL_SERPRO_LIMITE_MES se precisar.`);
  }
}

function inicioDoMes(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export async function usoDoMes(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(serproUso)
    .where(and(gte(serproUso.createdAt, inicioDoMes())));
  return Number(r?.n ?? 0);
}

function lerDados(v: unknown): any {
  if (typeof v !== "string") return v ?? null;
  if (!v.trim()) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export async function chamarIntegra(c: ChamadaIntegra): Promise<RespostaIntegra> {
  const usado = await usoDoMes();
  if (usado >= LIMITE_MES) throw new LimiteSerproError(usado);

  const ctx = await buildSerproContext();
  const payload = {
    contratante: { numero: ctx.cnpjContratante, tipo: 2 },
    autorPedidoDados: { numero: ctx.cnpjContratante, tipo: 2 },
    contribuinte: c.contribuinte,
    pedidoDados: {
      idSistema: c.idSistema,
      idServico: c.idServico,
      versaoSistema: c.versaoSistema ?? "1.0",
      dados: c.dados === "" ? "" : JSON.stringify(c.dados),
    },
  };

  let ok = false;
  try {
    const tokens = await getSerproToken(ctx.config, ctx.certAgent);
    const resp = await serproPost(`${ctx.baseUrl}/${c.rota}`, tokens, payload, ctx.certAgent);
    const texto = await resp.text();
    let corpo: any = {};
    try {
      corpo = JSON.parse(texto);
    } catch {
      /* corpo não-JSON */
    }
    const mensagens = Array.isArray(corpo?.mensagens) ? corpo.mensagens : [];
    const msgs = mensagens.map((m: any) => `${m?.codigo || ""} ${m?.texto || ""}`).join(" ");
    ok = resp.ok;
    return {
      ok: resp.ok,
      httpStatus: resp.status,
      mensagens,
      dados: lerDados(corpo?.dados),
      headers: resp.headers ?? {},
      // Sem procuração o SERPRO responde 403 / mensagem de acesso negado.
      semProcuracao: resp.status === 403 || /procura[çc][ãa]o|acesso negado|AcessoNegado/i.test(msgs),
      texto: texto.slice(0, 4000),
    };
  } finally {
    await db
      .insert(serproUso)
      .values({ idSistema: c.idSistema, idServico: c.idServico, clientId: c.clientId ?? null, ok, origem: c.origem })
      .catch(() => {});
  }
}
