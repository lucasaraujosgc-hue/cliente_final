import { apiFetch } from "./apiClient";

// Cliente do painel de pendências fiscais (contador). Ver
// src/server/routes/fiscal.routes.ts.

export type Processo = "OMISSOES" | "DEBITOS" | "PARCELAMENTOS" | "DIVIDA_ATIVA" | "FGTS" | "CAIXAPOSTAL";
export type Situacao = "em_dia" | "pendente" | "atencao" | "processando";

export const PROCESSOS: Processo[] = ["OMISSOES", "DEBITOS", "PARCELAMENTOS", "DIVIDA_ATIVA", "FGTS", "CAIXAPOSTAL"];

export const ROTULO: Record<Processo, string> = {
  OMISSOES: "Omissões",
  DEBITOS: "Débitos RFB",
  PARCELAMENTOS: "Parcelamentos",
  DIVIDA_ATIVA: "Dívida ativa",
  FGTS: "FGTS Digital",
  CAIXAPOSTAL: "Caixa Postal",
};

export const SITUACAO_ROTULO: Record<Situacao, string> = {
  em_dia: "Em dia",
  pendente: "Pendente",
  atencao: "Atenção",
  processando: "Processando",
};

// Relatório de situação fiscal já lido (ver services/fiscal/sitfisParser.ts).
export interface SitfisItem {
  texto: string;
  receita?: string;
  codigoReceita?: string;
  pa?: string;
  vencimento?: string;
  valorOriginal?: number;
  saldoDevedor?: number;
  multa?: number;
  juros?: number;
  saldoConsolidado?: number;
  situacao?: string;
  referencia?: string;
  parcelasEmAtraso?: number;
}
export interface SitfisSecao {
  orgao: "RFB" | "PGFN";
  tipo: "omissao" | "debito" | "parcelamento" | "divida_ativa" | "processo" | "outra";
  titulo: string;
  periodos: string[];
  itens: SitfisItem[];
  total: number;
}
export interface SitfisResultado {
  emitidoEm: string | null;
  cnpj: string | null;
  razaoSocial: string | null;
  situacaoCadastral: string | null;
  secoes: SitfisSecao[];
  semPendencias: boolean;
  inconclusivo: boolean;
}

export interface StatusProcesso {
  status: Situacao;
  resumo: string;
  competencia: string | null;
  fonte: string;
  verificadoEm: string;
  detalhes: any;
}

export interface ClienteFiscal {
  id: string;
  nome: string;
  cnpj: string;
  geral: Situacao;
  monitorado: boolean;
  regime: string | null;
  processosManuais: boolean;
  temParcelamento: boolean;
  sitfis: { emitidoEm: string | null; temPdf: boolean; erro: string | null };
  processos: Partial<Record<Processo, StatusProcesso>>;
}

export interface NotificacaoFiscal {
  id: number;
  clientId: string;
  processo: string;
  titulo: string;
  descricao: string;
  lida: boolean;
  createdAt: string;
  cliente: string;
}

export interface PainelFiscal {
  resumo: Record<Situacao, number> & { total: number };
  porProcesso: ({ processo: Processo; rotulo: string } & Record<Situacao, number>)[];
  omissoes: { porDeclaracao: { declaracao: string; clientes: number }[]; semOmissao: number };
  totais: { debitos: number; dividaAtiva: number };
  clientes: ClienteFiscal[];
  notificacoes: NotificacaoFiscal[];
  uso: { mes: number; limite: number };
  ultimaRotina: { executadoEm: string; resultado: any } | null;
  ultimoSitfisTodos: { executadoEm: string; resultado: any } | null;
  sitfisEmAndamento: boolean;
  rotinaEmAndamento: boolean;
}

export interface Parcelamento {
  id: string;
  modalidade: string;
  numero: string;
  situacao: string | null;
  origem: "serpro" | "manual";
  valorParcela: number | null;
  parcelasTotal: number | null;
  diaVencimento: number | null;
  ultimoPagamento: string | null;
  ativo: boolean;
  detalhes: any;
}

export type TipoGuia = "DAS_SIMPLES" | "DCTFWEB_INSS";

/** Guia como o cliente vê no app (ver services/fiscal/guias.ts). */
export interface GuiaCliente {
  id: string;
  title: string;
  category: string;
  competence: string | null;
  dueDate: string | null;
  status: string;
  valor: number | null;
  pixCode: string | null;
  temArquivo: boolean;
  tipoGuia: TipoGuia | null;
  paymentStatus: string | null;
}

export interface DetalheClienteFiscal {
  cliente: { id: string; nome: string; cnpj: string };
  perfil: { regime: string | null; processos: Processo[] | null };
  processosEfetivos: Processo[];
  status: ({ processo: Processo } & StatusProcesso)[];
  parcelamentos: Parcelamento[];
  sitfis: { emitidoEm: string; temPdf: boolean; resultado: SitfisResultado | null; aviso: string | null } | null;
  sitfisErro: { em: string; erro: string | null } | null;
  guias: GuiaCliente[];
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init, "accountant");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Falha (HTTP ${res.status}).`);
  return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const getPainelFiscal = () => req<PainelFiscal>("/api/accountant/fiscal/painel");
export const rodarVerificacao = () => req("/api/accountant/fiscal/rotina", json("POST", {}));
export const emitirSitfisTodos = () => req("/api/accountant/fiscal/sitfis/todos", json("POST", {}));
export const getClienteFiscal = (id: string) => req<DetalheClienteFiscal>(`/api/accountant/fiscal/clientes/${id}`);
export const atualizarClienteFiscal = (id: string) => req(`/api/accountant/fiscal/clientes/${id}/atualizar`, json("POST", {}));
export const emitirSitfisCliente = (id: string) => req(`/api/accountant/fiscal/clientes/${id}/sitfis`, json("POST", {}));
export const salvarPerfilFiscal = (id: string, regime: string | null, processos: Processo[] | null) =>
  req(`/api/accountant/fiscal/clientes/${id}/perfil`, json("PUT", { regime, processos }));
export const criarParcelamento = (id: string, p: Partial<Parcelamento>) =>
  req(`/api/accountant/fiscal/clientes/${id}/parcelamentos`, json("POST", p));
export const editarParcelamento = (pid: string, p: Partial<Parcelamento>) =>
  req(`/api/accountant/fiscal/parcelamentos/${pid}`, json("PUT", p));
export const excluirParcelamento = (pid: string) => req(`/api/accountant/fiscal/parcelamentos/${pid}`, { method: "DELETE" });
export const buscarParcelamentosSerpro = (id: string) =>
  req<{ encontrados: number; semProcuracao: boolean }>(`/api/accountant/fiscal/clientes/${id}/parcelamentos/buscar`, json("POST", {}));
export const marcarNotificacoesLidas = (ids?: number[]) => req("/api/accountant/fiscal/notificacoes/lidas", json("POST", { ids }));
/** Baixa do contador (mesma rota da ficha do cliente): "paid" dá baixa; "late" desfaz. */
export const marcarGuiaPaga = (docId: string, pago: boolean) =>
  req(`/api/accountant/document/${docId}/status`, json("POST", { status: pago ? "paid" : "late" }));

export interface GuiaPublicada {
  documentId: string;
  substituiu: boolean;
  title: string;
  competencia: string;
  dueDate: string | null;
  valor: number | null;
  pixCode: string | null;
}

/**
 * Gera a guia no Integra Contador (mesmo endpoint do botão "Atualizar guia" do
 * cliente, 1 consulta) e publica no app do cliente: substitui a guia em aberto
 * da mesma competência — ou a de `documentId` — ou cria uma nova.
 */
export async function gerarEPublicarGuia(clientId: string, tipoGuia: TipoGuia, competencia: string, documentId?: string) {
  const [mm, yyyy] = competencia.split("/");
  const g = await req<{ guiaId: number }>(`/api/pendencies/guia/${clientId}`, json("POST", { tipoGuia, competencia: `${yyyy}${mm}` }));
  return req<GuiaPublicada>(`/api/accountant/fiscal/clientes/${clientId}/guias/publicar`, json("POST", { guiaId: g.guiaId, documentId }));
}

/** Abre o PDF do último relatório de situação fiscal do cliente. */
export async function abrirPdfSitfis(clientId: string, cnpj: string) {
  const res = await apiFetch(`/api/accountant/fiscal/clientes/${clientId}/sitfis/pdf`, {}, "accountant");
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Relatório não disponível.");
  const blob = await res.blob();
  const { isNativeApp, shareNativeBlob } = await import("./native");
  if (isNativeApp() && (await shareNativeBlob(blob, `situacao-fiscal-${cnpj.replace(/\D/g, "")}.pdf`))) return;
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    const a = document.createElement("a");
    a.href = url;
    a.download = `situacao-fiscal-${cnpj.replace(/\D/g, "")}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// --- Para o "Gerar guia" a partir de um débito do relatório ----------------------

/** Débito do relatório → guia que dá para gerar (DAS do Simples ou DCTFWeb/INSS). */
export function guiaDoItem(item: SitfisItem): { tipoGuia: TipoGuia; competencia: string } | null {
  const pa = String(item.pa || "").match(/^(\d{2})\/(\d{4})$/);
  if (!pa) return null; // PA diário (multa por atraso etc.) não vira guia mensal
  const receita = `${item.codigoReceita || ""} ${item.receita || ""} ${item.texto || ""}`.toUpperCase();
  if (/MAED|MULTA/.test(receita)) return null;
  if (/SIMPLES/.test(receita)) return { tipoGuia: "DAS_SIMPLES", competencia: `${pa[1]}/${pa[2]}` };
  if (/\bCP\b|PREVID|INSS|SEGURAD/.test(receita)) return { tipoGuia: "DCTFWEB_INSS", competencia: `${pa[1]}/${pa[2]}` };
  return null;
}

export const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "YYYY-MM-DD[...]" ou "DD/MM/YYYY" → Date local. */
export function dataDe(v?: string | null): Date | null {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}
