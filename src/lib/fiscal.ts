import { apiFetch } from "./apiClient";

// Cliente do painel de pendências fiscais (contador). Ver
// src/server/routes/fiscal.routes.ts.

export type Processo = "PGDASD" | "DCTFWEB" | "FGTS" | "PARCELAMENTOS" | "CAIXAPOSTAL" | "PROCURACAO";
export type Situacao = "em_dia" | "pendente" | "atencao" | "processando";

export const PROCESSOS: Processo[] = ["PGDASD", "DCTFWEB", "FGTS", "PARCELAMENTOS", "CAIXAPOSTAL", "PROCURACAO"];

export const ROTULO: Record<Processo, string> = {
  PGDASD: "PGDAS-D",
  DCTFWEB: "DCTFWeb",
  FGTS: "FGTS Digital",
  PARCELAMENTOS: "Parcelamentos",
  CAIXAPOSTAL: "Caixa Postal",
  PROCURACAO: "Procuração",
};

export const SITUACAO_ROTULO: Record<Situacao, string> = {
  em_dia: "Em dia",
  pendente: "Pendente",
  atencao: "Atenção",
  processando: "Processando",
};

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
  ausencias: Record<"PGDASD" | "DCTFWEB", { ausentes: number; entregues: number }>;
  clientes: ClienteFiscal[];
  notificacoes: NotificacaoFiscal[];
  uso: { mes: number; limite: number };
  ultimaRotina: { executadoEm: string; resultado: any } | null;
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

export interface DetalheClienteFiscal {
  cliente: { id: string; nome: string; cnpj: string };
  perfil: { regime: string | null; processos: Processo[] | null };
  processosEfetivos: Processo[];
  parcelamentos: Parcelamento[];
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
export const getClienteFiscal = (id: string) => req<DetalheClienteFiscal>(`/api/accountant/fiscal/clientes/${id}`);
export const atualizarClienteFiscal = (id: string, consultarSerpro: boolean) =>
  req(`/api/accountant/fiscal/clientes/${id}/atualizar`, json("POST", { consultarSerpro }));
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
