import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { clients, fiscalPerfil } from "../../schema";
import { getClientConfig, upsertClientConfig } from "./config";
import { lookupCnpj } from "./cnpjLookup";
import { sincronizarDistribuicao } from "./distribuicao";
import { nfseLog } from "./log";

// "Configurar e buscar notas de todos": para cada cliente sem certificado A1
// cadastrado, liga a NFS-e por procuração em produção (município pela consulta
// do CNPJ, regime pelo perfil fiscal) — sem ligar a EMISSÃO, que ainda depende
// das atividades — e busca as notas no portal nacional (ADN: sem custo no
// Integra Contador). A busca já preenche o faturamento pelas notas
// (billing.ts → aplicarFaturamentoNfse).

export type AcaoLote = "configurado" | "procuracao_ligada" | "mantido";

export interface ResultadoCliente {
  clientId: string;
  nome: string;
  acao: AcaoLote | null;
  municipio: string | null;
  notasNovas: number;
  tomadasNovas: number;
  mesesFaturamento: number;
  divergentes: number; // meses com faturamento informado antes ≠ notas (não sobrescritos)
  erro: string | null;
}

export interface EstadoLote {
  emAndamento: boolean;
  inicio: string;
  fim: string | null;
  total: number;
  feitos: number;
  resultados: ResultadoCliente[];
}

let estado: EstadoLote | null = null;
export const estadoLote = () => estado;

const REGIME: Record<string, string> = { simples: "simples_nacional", mei: "mei", presumido: "normal", real: "normal" };
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function processarCliente(c: { id: string; name: string; cnpj: string }): Promise<ResultadoCliente> {
  const r: ResultadoCliente = {
    clientId: c.id,
    nome: c.name,
    acao: null,
    municipio: null,
    notasNovas: 0,
    tomadasNovas: 0,
    mesesFaturamento: 0,
    divergentes: 0,
    erro: null,
  };
  try {
    const cfg = await getClientConfig(c.id);
    if (cfg?.certPath || cfg?.usarProcuracao) {
      r.acao = "mantido"; // já tem A1 próprio ou já está por procuração
      r.municipio = cfg.codigoMunicipio ?? null;
    } else {
      const [perfil] = await db.select({ regime: fiscalPerfil.regime }).from(fiscalPerfil).where(eq(fiscalPerfil.clientId, c.id));
      const regime = REGIME[perfil?.regime ?? ""] ?? "simples_nacional";
      const municipio = cfg?.codigoMunicipio || (await lookupCnpj(c.cnpj).then((t) => t.endereco?.codigoMunicipio ?? null).catch(() => null));
      await upsertClientConfig(c.id, c.cnpj, {
        usarProcuracao: true,
        ambiente: "producao",
        regimeTributario: regime,
        optanteSimplesNacional: regime !== "normal",
        ...(municipio ? { codigoMunicipio: municipio } : {}),
      });
      r.acao = cfg ? "procuracao_ligada" : "configurado";
      r.municipio = municipio;
    }
    const s = await sincronizarDistribuicao(c.id, { maxLotes: 50 });
    r.notasNovas = s.novas;
    r.tomadasNovas = s.novasTomadas;
    r.mesesFaturamento = s.faturamento?.mesesAtualizados ?? 0;
    r.divergentes = s.faturamento?.divergentes.length ?? 0;
  } catch (e) {
    r.erro = e instanceof Error ? e.message : String(e);
  }
  return r;
}

/** Roda em segundo plano; o andamento fica em estadoLote(). */
export async function rodarLoteProcuracao(): Promise<EstadoLote> {
  if (estado?.emAndamento) return estado;
  const todos = await db.select({ id: clients.id, name: clients.name, cnpj: clients.cnpj }).from(clients).orderBy(asc(clients.name));
  estado = { emAndamento: true, inicio: new Date().toISOString(), fim: null, total: todos.length, feitos: 0, resultados: [] };
  const atual = estado;
  void (async () => {
    for (const c of todos) {
      atual.resultados.push(await processarCliente(c));
      atual.feitos++;
      await espera(800); // não martelar o ADN
    }
    atual.emAndamento = false;
    atual.fim = new Date().toISOString();
    nfseLog("info", "lote.procuracao.fim", {
      total: atual.total,
      erros: atual.resultados.filter((x) => x.erro).length,
      notas: atual.resultados.reduce((a, x) => a + x.notasNovas, 0),
    });
  })();
  return estado;
}

// --- "Sugerir atividades de todos" -------------------------------------------
// Para cada cliente: atividades pelas notas anteriores ou pelo CNAE, criadas
// desligadas e marcadas como sugeridas (services/nfse/sugestao.ts).

export interface ResultadoAtividades {
  clientId: string;
  nome: string;
  criadas: { cTribNac: string; nome: string; origem: "notas" | "cnae"; conferir: string | null; aliqMunicipal: number | null }[];
  jaExistiam: number;
  motivo: string | null;
  erro: string | null;
}
export interface EstadoLoteAtividades {
  emAndamento: boolean;
  inicio: string;
  fim: string | null;
  total: number;
  feitos: number;
  resultados: ResultadoAtividades[];
}

let estadoAtv: EstadoLoteAtividades | null = null;
export const estadoLoteAtividades = () => estadoAtv;

export async function rodarLoteAtividades(): Promise<EstadoLoteAtividades> {
  if (estadoAtv?.emAndamento) return estadoAtv;
  const { sugerirAtividades } = await import("./sugestao");
  const todos = await db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name));
  estadoAtv = { emAndamento: true, inicio: new Date().toISOString(), fim: null, total: todos.length, feitos: 0, resultados: [] };
  const atual = estadoAtv;
  void (async () => {
    for (const c of todos) {
      try {
        const r = await sugerirAtividades(c.id);
        atual.resultados.push({ clientId: c.id, nome: c.name, ...r, erro: null });
      } catch (e) {
        atual.resultados.push({ clientId: c.id, nome: c.name, criadas: [], jaExistiam: 0, motivo: null, erro: e instanceof Error ? e.message : String(e) });
      }
      atual.feitos++;
      await espera(600); // consulta de CNAE e de parâmetros municipais
    }
    atual.emAndamento = false;
    atual.fim = new Date().toISOString();
    nfseLog("info", "lote.atividades.fim", { total: atual.total, criadas: atual.resultados.reduce((a, x) => a + x.criadas.length, 0) });
  })();
  return estadoAtv;
}
