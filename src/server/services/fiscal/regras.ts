// Regras puras do painel de pendências fiscais — sem banco e sem SERPRO.
//
// Fonte principal: o Relatório de Situação Fiscal (SITFIS), emitido uma vez por
// semana (segunda-feira) — ele já traz omissões de declaração, débitos na
// Receita, parcelamentos com atraso e inscrições em dívida ativa. O que ele não
// cobre vem de fontes baratas: FGTS pelas guias do portal marcadas como pagas
// (pelo cliente ou pelo contador); Caixa Postal pelo evento de atualização
// (1 consulta p/ todos os CNPJs) — só aparece quem tem mensagem não lida.

import type { SitfisResultado, SitfisSecao } from "./sitfisParser";

export type Processo = "OMISSOES" | "DEBITOS" | "PARCELAMENTOS" | "DIVIDA_ATIVA" | "FGTS" | "CAIXAPOSTAL";
export type Situacao = "em_dia" | "pendente" | "atencao" | "processando";

export const PROCESSOS: Processo[] = ["OMISSOES", "DEBITOS", "PARCELAMENTOS", "DIVIDA_ATIVA", "FGTS", "CAIXAPOSTAL"];

export const PROCESSO_ROTULO: Record<Processo, string> = {
  OMISSOES: "Omissões",
  DEBITOS: "Débitos RFB",
  PARCELAMENTOS: "Parcelamentos",
  DIVIDA_ATIVA: "Dívida ativa",
  FGTS: "FGTS Digital",
  CAIXAPOSTAL: "Caixa Postal",
};

// Processos que vêm do relatório de situação fiscal.
export const PROCESSOS_SITFIS: Processo[] = ["OMISSOES", "DEBITOS", "PARCELAMENTOS", "DIVIDA_ATIVA"];

const PESO: Record<Situacao, number> = { em_dia: 0, processando: 1, pendente: 2, atencao: 3 };

/** A pior situação entre várias (atenção > pendente > processando > em dia). */
export function piorSituacao(lista: Situacao[]): Situacao {
  return lista.reduce<Situacao>((acc, s) => (PESO[s] > PESO[acc] ? s : acc), "em_dia");
}

/** Piorou? (serve para avisar só quando aparece pendência nova). */
export function piorou(antes: Situacao | undefined, depois: Situacao): boolean {
  return antes === "em_dia" && PESO[depois] >= PESO.pendente;
}

/** Competência de referência: o mês anterior a `hoje` (MM/YYYY). */
export function competenciaAnterior(hoje: Date): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** "DD/MM/YYYY" ou "YYYY-MM-DD[...]" → Date (meia-noite local). */
export function parseData(v?: string | null): Date | null {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
export const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface DocGuia {
  category: string;
  title?: string | null;
  competence?: string | null;
  dueDate?: string | null;
  status: string;
  createdAt?: Date | string | null;
}

export const ehFgts = (d: { category?: string | null }) => String(d.category || "").trim().toLowerCase() === "fgts";
const pago = (status: string) => status === "paid" || status === "ok";

/**
 * Processos do cliente. Os do relatório valem para todos (qualquer CNPJ pode
 * ter omissão ou débito); FGTS só para quem recebe guia de FGTS no portal.
 */
export function inferirProcessos(docs: DocGuia[], hoje: Date): Processo[] {
  const limite = new Date(hoje.getFullYear(), hoje.getMonth() - 6, 1);
  const temFgts = docs.some((d) => ehFgts(d) && (!d.createdAt || new Date(d.createdAt) >= limite));
  return PROCESSOS.filter((p) => p !== "FGTS" || temFgts);
}

/**
 * Perfil salvo com os códigos da 1ª versão do painel (PGDASD, DCTFWEB) passa a
 * valer pelos equivalentes do relatório; códigos que saíram (PROCURACAO) somem.
 */
export function normalizarProcessos(lista: unknown[]): Processo[] {
  const out = new Set<Processo>();
  for (const p of lista) {
    if (p === "PGDASD" || p === "DCTFWEB") {
      out.add("OMISSOES");
      out.add("DEBITOS");
    } else if ((PROCESSOS as unknown[]).includes(p)) out.add(p as Processo);
  }
  return PROCESSOS.filter((p) => out.has(p));
}

export interface Avaliacao {
  status: Situacao;
  resumo: string;
  competencia?: string | null;
  detalhes?: Record<string, unknown>;
}

/**
 * FGTS pelas guias publicadas no portal e marcadas como pagas — pelo cliente
 * ("Marcar como pago") ou pelo contador (baixa). O SITFIS não cobre FGTS e o
 * FGTS Digital não tem consulta no Integra Contador.
 */
export function avaliarFgts(docs: DocGuia[], hoje: Date): Avaliacao {
  const guias = docs
    .filter((d) => ehFgts(d) && parseData(d.dueDate))
    .sort((a, b) => parseData(a.dueDate)!.getTime() - parseData(b.dueDate)!.getTime());
  if (!guias.length) return { status: "pendente", resumo: "Nenhuma guia de FGTS publicada no portal" };
  const fimDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  const abertas = guias.filter((g) => !pago(g.status));
  const atrasadas = abertas.filter((g) => hoje > fimDoDia(parseData(g.dueDate)!));
  const nome = (g: DocGuia) => g.competence?.trim() || fmt(parseData(g.dueDate)!);
  const lista = (gs: DocGuia[]) => gs.map((g) => ({ titulo: g.title ?? null, competencia: g.competence ?? null, vencimento: g.dueDate ?? null }));
  if (atrasadas.length) {
    return {
      status: "atencao",
      competencia: atrasadas[atrasadas.length - 1].competence ?? null,
      resumo: `${atrasadas.length} guia(s) do FGTS sem pagamento marcado: ${atrasadas.map(nome).join(", ")}`,
      detalhes: { guias: lista(atrasadas) },
    };
  }
  if (abertas.length) {
    const prox = abertas[0];
    return { status: "pendente", competencia: prox.competence ?? null, resumo: `FGTS de ${nome(prox)} vence ${fmt(parseData(prox.dueDate)!)}` };
  }
  const ultima = guias[guias.length - 1];
  return { status: "em_dia", competencia: ultima.competence ?? null, resumo: `FGTS pago (último: ${nome(ultima)})` };
}

// --- Relatório de situação fiscal ------------------------------------------------

const declaracaoDa = (s: SitfisSecao) => s.titulo.replace(/^Omiss[ãa]o de\s*/i, "").trim() || s.titulo;

/** Situação de cada processo do relatório. Sem relatório: aguardando. */
export function avaliarSitfis(r: SitfisResultado | null, emitidoEm?: string | null): Record<"OMISSOES" | "DEBITOS" | "PARCELAMENTOS" | "DIVIDA_ATIVA", Avaliacao> {
  const quando = emitidoEm ? ` (relatório de ${emitidoEm.slice(0, 10)})` : "";
  if (!r) {
    const a: Avaliacao = { status: "processando", resumo: "Aguardando o relatório de situação fiscal (emitido às segundas)" };
    return { OMISSOES: a, DEBITOS: a, PARCELAMENTOS: a, DIVIDA_ATIVA: a };
  }
  if (r.inconclusivo) {
    const a: Avaliacao = { status: "processando", resumo: `Não foi possível ler o relatório${quando} — abra o PDF` };
    return { OMISSOES: a, DEBITOS: a, PARCELAMENTOS: a, DIVIDA_ATIVA: a };
  }
  const de = (...tipos: string[]) => r.secoes.filter((s) => tipos.includes(s.tipo));

  const omissoes = de("omissao");
  const OMISSOES: Avaliacao = omissoes.length
    ? {
        status: "atencao",
        resumo: `Omissão: ${omissoes.map((s) => `${declaracaoDa(s)}${s.periodos.length ? ` (${s.periodos.join(", ")})` : ""}`).join("; ")}`,
        detalhes: { secoes: omissoes, declaracoes: omissoes.map(declaracaoDa) },
      }
    : { status: "em_dia", resumo: `Nenhuma omissão de declaração${quando}` };

  const debitos = de("debito", "processo", "outra");
  const itensDeb = debitos.flatMap((s) => s.itens);
  const totalDeb = debitos.reduce((acc, s) => acc + s.total, 0);
  const DEBITOS: Avaliacao = debitos.length
    ? {
        status: "atencao",
        resumo: `${itensDeb.length || debitos.length} débito(s) na Receita${totalDeb ? ` — ${brl(totalDeb)}` : ""}`,
        detalhes: { secoes: debitos, total: totalDeb },
      }
    : { status: "em_dia", resumo: `Nenhum débito na Receita${quando}` };

  const parc = de("parcelamento");
  const emAtraso = parc.flatMap((s) => s.itens).filter((i) => (i.parcelasEmAtraso ?? 0) > 0);
  const PARCELAMENTOS: Avaliacao = parc.length
    ? {
        status: emAtraso.length ? "atencao" : "pendente",
        resumo: emAtraso.length
          ? emAtraso.map((i) => `${i.situacao || "Parcelamento"}: ${i.parcelasEmAtraso} parcela(s) em atraso`).join("; ")
          : parc.map((s) => s.titulo).join("; "),
        detalhes: { secoes: parc },
      }
    : { status: "em_dia", resumo: `Nenhum parcelamento com pendência${quando}` };

  const da = de("divida_ativa");
  const itensDa = da.flatMap((s) => s.itens);
  const totalDa = da.reduce((acc, s) => acc + s.total, 0);
  const DIVIDA_ATIVA: Avaliacao = da.length
    ? {
        status: "atencao",
        resumo: `${itensDa.length || da.length} inscrição(ões) em dívida ativa${totalDa ? ` — ${brl(totalDa)}` : ""}`,
        detalhes: { secoes: da, total: totalDa },
      }
    : { status: "em_dia", resumo: `Nenhuma inscrição em dívida ativa${quando}` };

  return { OMISSOES, DEBITOS, PARCELAMENTOS, DIVIDA_ATIVA };
}

// --- Eventos de atualização e agenda ------------------------------------------

export type CodigoEvento = "E0301" | "E0601" | "E0701";
// Só a Caixa Postal: DCTFWeb (omissão/débito) já vem no relatório semanal, e
// pagamentos só geravam aviso.
export const EVENTOS: CodigoEvento[] = ["E0601"];

/** `elementos` = [[ni, "AAMMDD" | "" | "x"], …] → Map(cnpj → valor). */
export function lerElementos(elementos: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(elementos)) return out;
  for (const linha of elementos) {
    if (!Array.isArray(linha)) continue;
    const ni = String(linha[0] ?? "").replace(/\D/g, "");
    if (ni) out.set(ni, String(linha[1] ?? "").trim());
  }
  return out;
}

/** "AAMMDD" → Date. */
export function dataDoEvento(v: string): Date | null {
  const m = String(v || "").match(/^(\d{2})(\d{2})(\d{2})$/);
  return m ? new Date(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// Custo no Integra Contador: relatório = 2 chamadas por cliente (pedir +
// emitir), 1×/semana; Caixa Postal = 2 chamadas para todos, 2×/semana.
export interface Agenda {
  sitfisDiasSemana: number[]; // 0 = domingo … 6 = sábado
  caixaPostalDiasSemana: number[];
}
export const AGENDA_PADRAO: Agenda = { sitfisDiasSemana: [1], caixaPostalDiasSemana: [1, 4] };

const diaDaSemanaBrt = (agora: Date) => new Date(agora.getTime() - 3 * 3_600_000).getUTCDay();

/** Caixa Postal hoje? (evento nunca lido roda na hora, como linha de base). */
export function eventosDoDia(agora: Date, jaLidos: Set<string>, agenda: Agenda = AGENDA_PADRAO): CodigoEvento[] {
  return !jaLidos.has("E0601") || agenda.caixaPostalDiasSemana.includes(diaDaSemanaBrt(agora)) ? ["E0601"] : [];
}

/** Dia de emitir o relatório de situação fiscal? */
export function diaDeSitfis(agora: Date, agenda: Agenda = AGENDA_PADRAO): boolean {
  return agenda.sitfisDiasSemana.includes(diaDaSemanaBrt(agora));
}

/** "1,4" → [1, 4] (valores inválidos são ignorados). */
export function lerListaNumeros(v: string | undefined, min: number, max: number): number[] | null {
  if (!v || !v.trim()) return null;
  const nums = v.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= min && n <= max);
  return nums.length ? nums : null;
}

// --- Competências ---------------------------------------------------------------

/** Valor AAAAMM / AAAAMMDD do SERPRO → "MM/YYYY". */
export function competenciaDeAAAAMM(v: unknown): string | null {
  const m = String(v ?? "").match(/^(\d{4})(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : null;
}

/** "MM/YYYY" → "AAAAMM". */
export function aaaammDe(competencia: string): string {
  const [mm, yyyy] = competencia.split("/");
  return `${yyyy}${mm}`;
}

/** Compara "MM/YYYY" (a < b → negativo). */
export function compararCompetencia(a: string, b: string): number {
  return Number(aaaammDe(a)) - Number(aaaammDe(b));
}
