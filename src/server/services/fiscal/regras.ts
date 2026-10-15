// Regras puras do painel de pendências fiscais — sem banco e sem SERPRO.
//
// Ordem de preferência das fontes (do mais barato ao mais caro):
//   1. documentos publicados no portal (guias DAS / INSS / FGTS / parcelamento)
//   2. eventos de atualização do Integra Contador (1 chamada p/ todos os CNPJs)
//   3. consulta pontual no Integra Contador — só quando 1 e 2 não respondem
//      e o prazo da obrigação já passou.

export type Processo = "PGDASD" | "DCTFWEB" | "FGTS" | "PARCELAMENTOS" | "CAIXAPOSTAL" | "PROCURACAO";
export type Situacao = "em_dia" | "pendente" | "atencao" | "processando";

export const PROCESSOS: Processo[] = ["PGDASD", "DCTFWEB", "FGTS", "PARCELAMENTOS", "CAIXAPOSTAL", "PROCURACAO"];

export const PROCESSO_ROTULO: Record<Processo, string> = {
  PGDASD: "PGDAS-D",
  DCTFWEB: "DCTFWeb",
  FGTS: "FGTS Digital",
  PARCELAMENTOS: "Parcelamentos",
  CAIXAPOSTAL: "Caixa Postal",
  PROCURACAO: "Procuração",
};

// Categoria do documento publicado no portal que representa a guia do processo.
export const CATEGORIA_GUIA: Partial<Record<Processo, string[]>> = {
  PGDASD: ["simples nacional"],
  DCTFWEB: ["inss"],
  FGTS: ["fgts"],
  PARCELAMENTOS: ["parcelamento"],
};

// Dia do mês seguinte à competência em que a obrigação vence.
export const DIA_PRAZO: Partial<Record<Processo, number>> = {
  PGDASD: 20, // DAS
  DCTFWEB: 15, // declaração (a guia vence dia 20)
  FGTS: 20, // FGTS Digital
};

const PESO: Record<Situacao, number> = { em_dia: 0, processando: 1, pendente: 2, atencao: 3 };

/** A pior situação entre várias (atenção > pendente > processando > em dia). */
export function piorSituacao(lista: Situacao[]): Situacao {
  return lista.reduce<Situacao>((acc, s) => (PESO[s] > PESO[acc] ? s : acc), "em_dia");
}

/** Competência de referência: o mês anterior a `hoje` (MM/YYYY). */
export function competenciaAnterior(hoje: Date): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Data do prazo (no mês seguinte à competência MM/YYYY). */
export function prazoDa(competencia: string, dia: number): Date {
  const [mm, yyyy] = competencia.split("/").map(Number);
  return new Date(yyyy, mm, dia, 23, 59, 59); // mês seguinte (mm já é 1-based)
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

export interface DocGuia {
  category: string;
  title?: string | null;
  competence?: string | null;
  dueDate?: string | null;
  status: string;
  createdAt?: Date | string | null;
}

function ehDoProcesso(doc: DocGuia, processo: Processo): boolean {
  const cats = CATEGORIA_GUIA[processo] || [];
  return cats.includes(String(doc.category || "").trim().toLowerCase());
}

/** Processos que se aplicam ao cliente, pelos documentos publicados (últimos 6 meses). */
export function inferirProcessos(docs: DocGuia[], hoje: Date, temParcelamento: boolean): Processo[] {
  const limite = new Date(hoje.getFullYear(), hoje.getMonth() - 6, 1);
  const recentes = docs.filter((d) => {
    const c = d.createdAt ? new Date(d.createdAt) : null;
    return !c || c >= limite;
  });
  const out = new Set<Processo>(["CAIXAPOSTAL", "PROCURACAO"]);
  for (const p of ["PGDASD", "DCTFWEB", "FGTS", "PARCELAMENTOS"] as Processo[]) {
    if (recentes.some((d) => ehDoProcesso(d, p))) out.add(p);
  }
  if (temParcelamento) out.add("PARCELAMENTOS");
  return PROCESSOS.filter((p) => out.has(p));
}

export interface Avaliacao {
  status: Situacao;
  resumo: string;
  competencia?: string | null;
  detalhes?: Record<string, unknown>;
}

/**
 * Situação de um processo com guia mensal (PGDAS-D, DCTFWeb, FGTS) para a
 * competência, olhando só as guias publicadas no portal. `semGuia` = true
 * quando não há guia — o chamador decide se vale consultar o SERPRO.
 */
export function avaliarPorGuias(
  processo: Processo,
  docs: DocGuia[],
  competencia: string,
  hoje: Date,
): Avaliacao & { semGuia: boolean } {
  const guias = docs.filter((d) => ehDoProcesso(d, processo) && (d.competence || "").trim() === competencia);
  const prazo = prazoDa(competencia, DIA_PRAZO[processo] ?? 20);
  if (guias.length === 0) {
    const vencido = hoje > prazo;
    return {
      status: vencido ? "atencao" : "pendente",
      resumo: vencido
        ? `Sem guia da competência ${competencia} (prazo ${fmt(prazo)})`
        : `Aguardando a guia de ${competencia} (prazo ${fmt(prazo)})`,
      competencia,
      semGuia: true,
    };
  }
  if (guias.some((g) => g.status === "paid")) {
    return { status: "em_dia", resumo: `Guia de ${competencia} paga`, competencia, semGuia: false };
  }
  const venc = guias.map((g) => parseData(g.dueDate)).filter(Boolean) as Date[];
  const menor = venc.length ? new Date(Math.min(...venc.map((d) => d.getTime()))) : prazo;
  const fimDoDia = new Date(menor.getFullYear(), menor.getMonth(), menor.getDate(), 23, 59, 59);
  if (hoje > fimDoDia) {
    return { status: "atencao", resumo: `Guia de ${competencia} vencida em ${fmt(menor)}`, competencia, semGuia: false };
  }
  return { status: "pendente", resumo: `Guia de ${competencia} vence ${fmt(menor)}`, competencia, semGuia: false };
}

// --- Eventos de atualização ---------------------------------------------------

export type CodigoEvento = "E0301" | "E0601" | "E0701";
// Monitorados: DCTFWeb e Caixa Postal. Pagamentos (E0701) ficou de fora — só
// gerava um aviso, e o pagamento já é conferido pela rotina de pagamentos.
export const EVENTOS: CodigoEvento[] = ["E0301", "E0601"];

// Cada evento custa 2 chamadas (o serviço é assíncrono: solicitar + obter).
// Agenda enxuta: Caixa Postal 2×/semana (intimação tem prazo de semanas) e
// DCTFWeb 1×/mês, logo depois do prazo da declaração (dia 15). Evento que
// nunca foi lido roda na hora, para o painel não ficar "processando".
export interface AgendaEventos {
  caixaPostalDiasSemana: number[]; // 0 = domingo … 6 = sábado
  dctfwebDiasMes: number[];
}
export const AGENDA_PADRAO: AgendaEventos = { caixaPostalDiasSemana: [1, 4], dctfwebDiasMes: [16] };

/** Eventos a consultar hoje (dia no fuso de Brasília). */
export function eventosDoDia(agora: Date, jaLidos: Set<string>, agenda: AgendaEventos = AGENDA_PADRAO): CodigoEvento[] {
  const brt = new Date(agora.getTime() - 3 * 3_600_000);
  const out: CodigoEvento[] = [];
  if (!jaLidos.has("E0301") || agenda.dctfwebDiasMes.includes(brt.getUTCDate())) out.push("E0301");
  if (!jaLidos.has("E0601") || agenda.caixaPostalDiasSemana.includes(brt.getUTCDay())) out.push("E0601");
  return out;
}

/** "1,4" → [1, 4] (valores inválidos são ignorados). */
export function lerListaNumeros(v: string | undefined, min: number, max: number): number[] | null {
  if (!v || !v.trim()) return null;
  const nums = v.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= min && n <= max);
  return nums.length ? nums : null;
}

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

/**
 * DCTFWeb transmitida para a competência? Pelo evento E0301 (data da última
 * transmissão): conta se aconteceu depois do fim da competência. Retificação
 * de competência antiga também move a data — por isso é só indício; sem
 * transmissão nenhuma depois do fim da competência, é certeza de que não foi.
 * Valor vazio ("sem atualização") não diz desde quando — fica desconhecido
 * (null), e aí vale a consulta pontual.
 */
export function dctfwebTransmitidaPeloEvento(valor: string | undefined, competencia: string): boolean | null {
  if (valor === undefined || valor === "x" || valor === "") return null;
  const d = dataDoEvento(valor);
  if (!d) return null;
  const [mm, yyyy] = competencia.split("/").map(Number);
  return d >= new Date(yyyy, mm, 1);
}

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

// --- Parcelamentos -------------------------------------------------------------

export interface ParcelamentoInfo {
  modalidade: string;
  numero: string;
  origem: string;
  situacao?: string | null;
  ativo: boolean;
  ultimoPagamento?: string | null; // MM/YYYY
  diaVencimento?: number | null;
}

/** Compara "MM/YYYY" (a < b → negativo). */
export function compararCompetencia(a: string, b: string): number {
  return Number(aaaammDe(a)) - Number(aaaammDe(b));
}

/**
 * Parcelamento em dia? A parcela do mês M vence no próprio mês (último dia útil
 * no Simples; dia cadastrado nos manuais). Esperado: parcela do mês anterior
 * paga. Manuais sem pagamento registrado olham as guias "Parcelamento".
 */
export function avaliarParcelamento(
  p: ParcelamentoInfo,
  docs: DocGuia[],
  hoje: Date,
): Avaliacao {
  const nome = `${p.modalidade} ${p.numero}`;
  if (/rescindid|cancelad|encerrad|liquidad/i.test(p.situacao || "")) {
    return { status: "em_dia", resumo: `${nome}: ${p.situacao}` };
  }
  const esperada = competenciaAnterior(hoje);
  let ultimo = p.ultimoPagamento || null;
  if (!ultimo) {
    const pagas = docs
      .filter((d) => ehDoProcesso(d, "PARCELAMENTOS") && d.status === "paid" && d.competence)
      .map((d) => d.competence as string)
      .sort(compararCompetencia);
    ultimo = pagas.length ? pagas[pagas.length - 1] : null;
  }
  if (ultimo && compararCompetencia(ultimo, esperada) >= 0) {
    return { status: "em_dia", resumo: `${nome}: parcela ${ultimo} paga` };
  }
  if (!ultimo) {
    return { status: "pendente", resumo: `${nome}: nenhum pagamento identificado` };
  }
  return { status: "atencao", resumo: `${nome}: última parcela paga ${ultimo}` };
}
