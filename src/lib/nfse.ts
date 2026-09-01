import { apiFetch } from "./apiClient";
import type { ServicoLC116 } from "./listaServicosLC116";

export type { ServicoLC116 };

// ---------------------------------------------------------------------------
//  Shared types
// ---------------------------------------------------------------------------

export interface NfseStatus {
  enabled: boolean;
  ambiente: string | null;
  availableFrom: string;
  message: string;
  motivo?: string;
  codigoMunicipio?: string | null;
  regimeTributario?: string | null;
}

export interface NfseEmissao {
  id: string;
  status: string;
  tomadorNome: string | null;
  tomadorDoc: string | null;
  valorServicos: number | null; // centavos
  numeroNota: string | null;
  chaveAcesso: string | null;
  dataEmissao: string | null;
  createdAt: string;
  rejeicaoMotivo: string | null;
  canceladaEm: string | null;
}

export interface NfseEndereco {
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  codigoMunicipio?: string | null;
  uf?: string | null;
  cep?: string | null;
}

export interface NfseEmissaoDetail extends NfseEmissao {
  atividadeId: string | null;
  ambiente: string | null;
  competencia: string | null;
  descricao: string | null;
  aliquotaIss: number | null;
  valorIss: number | null;
  serieDps: string | null;
  numeroDps: number | null;
  tomadorEmail: string | null;
  tomadorTelefone: string | null;
  tomadorEndereco: NfseEndereco | null;
  rejeicaoCodigo: string | null;
  cancelamentoMotivo: string | null;
  hasDanfse: boolean;
}

export interface TomadorLookup {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  email: string | null;
  telefone: string | null;
  cnaePrincipal: string | null;
  situacao: string | null;
  endereco: Required<NfseEndereco>;
  fonte: "brasilapi" | "receitaws";
}

export interface NfseAtividade {
  id: string;
  nome: string;
  itemListaServico: string;
  codTributacaoNac: string | null;
  codTributacaoMun: string | null;
  cnae: string | null;
  cNbs: string | null;
  descricaoPadrao: string;
  aliquotaIss: number;
  issRetido: boolean;
  tribIssqn: string;
  exigibilidadeIss: string;
  municipioIncidencia: string | null;
  regApTribSn: string | null;
  codAtividadeSn: string | null;
  retIrrf: number;
  retPis: number;
  retCofins: number;
  retCsll: number;
  retInss: number;
  pisCofinsCst: string | null;
  aliquotaPis: number;
  aliquotaCofins: number;
  ibsCbsCst: string | null;
  ibsCbsClassTrib: string | null;
  ibsCbsCindOp: string | null;
  ibsCbsIndDest: string;
  ativo: boolean;
  ordem: number;
}

export interface NfseAdminConfig {
  id: string;
  ativo: boolean;
  ambiente: string;
  hasCert: boolean;
  certMissing: boolean;
  certCnpj: string | null;
  certValidadeAte: string | null;
  hasCertSenha: boolean;
  codigoMunicipio: string | null;
  regimeTributario: string;
  regimeEspecialTrib: string | null;
  optanteSimplesNacional: boolean;
  incentivoFiscal: boolean;
  serieDps: string;
  proxNumeroDps: number;
  updatedAt: string;
}

export interface NfseClientOverview {
  clientId: string;
  name: string;
  cnpj: string;
  cnpjFormatado: string;
  configured: boolean;
  ativo: boolean;
  ambiente: string | null;
  hasCert: boolean;
  certValidadeAte: string | null;
  certVencido: boolean;
  codigoMunicipio: string | null;
  atividadesAtivas: number;
  emissoes: number;
}

// ---------------------------------------------------------------------------
//  Client-facing API
// ---------------------------------------------------------------------------

export async function getNfseStatus(): Promise<NfseStatus> {
  const res = await apiFetch("/api/nfse");
  return res.json();
}

export interface NfseAtividadeCliente {
  id: string;
  nome: string;
  itemListaServico: string;
  descricaoPadrao: string;
  aliquotaIss: number;
  issRetido: boolean;
}

export async function getNfseAtividades(): Promise<NfseAtividadeCliente[]> {
  const res = await apiFetch("/api/nfse/atividades");
  const data = await res.json();
  return data.atividades || [];
}

export async function listEmissoes(): Promise<NfseEmissao[]> {
  const res = await apiFetch("/api/nfse/emissoes");
  const data = await res.json();
  return data.emissoes || [];
}

export async function getEmissao(id: string): Promise<NfseEmissaoDetail> {
  const res = await apiFetch(`/api/nfse/emissoes/${id}`);
  const data = await res.json();
  return data.emissao;
}

export async function lookupCnpjTomador(cnpj: string): Promise<TomadorLookup> {
  const res = await apiFetch("/api/nfse/lookup-cnpj", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cnpj }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Falha ao consultar o CNPJ.");
  return data.tomador;
}

export interface EmitirNfseInput {
  atividadeId: string;
  tomador: {
    doc: string;
    nome: string;
    email?: string;
    telefone?: string;
    inscricaoMunicipal?: string;
    endereco?: NfseEndereco;
  };
  descricao: string;
  valor: number; // centavos
  competencia?: string;
}

export interface EmitirNfseResult {
  ok: boolean;
  processando?: boolean; // DPS enviada, aguardando confirmação do Sefin
  id?: string;
  status?: string;
  chaveAcesso?: string;
  numeroNota?: string;
  error?: string;
  codigo?: string | null;
  motivo?: string | null;
}

export async function emitirNfse(input: EmitirNfseInput): Promise<EmitirNfseResult> {
  const res = await apiFetch("/api/nfse/emissoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  // 202 / body.processando = a nota foi enviada mas o Sefin ainda não confirmou.
  if (data.processando || res.status === 202) {
    return {
      ok: false,
      processando: true,
      id: data.id,
      status: "processando",
      error: data.error || data.motivo,
      motivo: data.motivo || data.error,
    };
  }
  if (!res.ok || data.ok === false) {
    return { ok: false, error: data.error || "Falha ao emitir a nota.", codigo: data.codigo, motivo: data.motivo };
  }
  return { ok: true, ...data };
}

export interface SincronizarResult {
  ok: boolean;
  status?: string;
  chaveAcesso?: string | null;
  numeroNota?: string | null;
  rejeicaoMotivo?: string | null;
  error?: string;
}

// Reconcilia uma emissão em 'processando' (consulta o Sefin; nunca reemite).
export async function sincronizarEmissao(id: string): Promise<SincronizarResult> {
  const res = await apiFetch(`/api/nfse/emissoes/${id}/sincronizar`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || "Falha ao consultar o Sefin." };
  return { ok: true, ...data };
}

export async function cancelarNfse(id: string, motivo: string): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch(`/api/nfse/emissoes/${id}/cancelar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motivo }),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: data.error || "Falha ao cancelar." };
}

let servicosCache: ServicoLC116[] | null = null;
export async function getListaServicos(): Promise<ServicoLC116[]> {
  if (servicosCache) return servicosCache;
  const res = await apiFetch("/api/nfse/lista-servicos");
  const data = await res.json();
  servicosCache = data.servicos || [];
  return servicosCache!;
}

// DANFSE (PDF) — fetch as a blob so it can be viewed or shared as a file.
export async function fetchDanfseBlob(id: string): Promise<Blob> {
  const res = await apiFetch(`/api/nfse/emissoes/${id}/danfse`);
  if (!res.ok) throw new Error("Não foi possível obter o PDF da nota.");
  return res.blob();
}

export async function viewDanfse(id: string, numero?: string | null): Promise<void> {
  const blob = await fetchDanfseBlob(id);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function shareDanfse(id: string, numero?: string | null): Promise<"shared" | "downloaded"> {
  const blob = await fetchDanfseBlob(id);
  const filename = `NFSe-${numero || id}.pdf`;
  const file = new File([blob], filename, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: any) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: filename });
      return "shared";
    } catch (e: any) {
      if (e?.name === "AbortError") return "shared";
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}

// ---------------------------------------------------------------------------
//  Accountant-facing API (/api/nfse/admin/*)
// ---------------------------------------------------------------------------

export async function adminListNfseClients(): Promise<NfseClientOverview[]> {
  const res = await apiFetch("/api/nfse/admin/clients", {}, "accountant");
  const data = await res.json();
  return data.clients || [];
}

export interface AdminClientNfse {
  client: { id: string; name: string; cnpj: string; cnpjFormatado: string };
  config: NfseAdminConfig | null;
  atividades: NfseAtividade[];
}

export async function adminGetClientNfse(clientId: string): Promise<AdminClientNfse> {
  const res = await apiFetch(`/api/nfse/admin/clients/${clientId}`, {}, "accountant");
  return res.json();
}

export async function adminSaveNfseConfig(
  clientId: string,
  fields: Record<string, string>,
  certFile?: File | null,
): Promise<{ config: NfseAdminConfig; warnings: string[] }> {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  if (certFile) body.append("cert", certFile);
  const res = await apiFetch(`/api/nfse/admin/clients/${clientId}/config`, { method: "PUT", body }, "accountant");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Falha ao salvar a configuração.");
  return data;
}

export type AtividadeInput = Omit<NfseAtividade, "id">;

export async function adminCreateAtividade(clientId: string, input: Partial<AtividadeInput>): Promise<NfseAtividade> {
  const res = await apiFetch(`/api/nfse/admin/clients/${clientId}/atividades`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, "accountant");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (data.details?.[0]?.message ?? "Falha ao criar atividade."));
  return data.atividade;
}

export async function adminUpdateAtividade(
  clientId: string,
  atividadeId: string,
  input: Partial<AtividadeInput>,
): Promise<NfseAtividade> {
  const res = await apiFetch(`/api/nfse/admin/clients/${clientId}/atividades/${atividadeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, "accountant");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Falha ao atualizar atividade.");
  return data.atividade;
}

export async function adminDeleteAtividade(clientId: string, atividadeId: string): Promise<void> {
  const res = await apiFetch(`/api/nfse/admin/clients/${clientId}/atividades/${atividadeId}`, {
    method: "DELETE",
  }, "accountant");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Falha ao remover atividade.");
  }
}

export interface NfseTestResult {
  ok: boolean;
  ambiente?: string;
  certCnpj?: string | null;
  certValidadeAte?: string | null;
  certVencido?: boolean;
  codigoMunicipio?: string | null;
  error?: string;
  reason?: string | null;
}

export async function adminTestNfseConfig(clientId: string): Promise<NfseTestResult> {
  const res = await apiFetch(`/api/nfse/admin/clients/${clientId}/test`, { method: "POST" }, "accountant");
  return res.json();
}

export async function adminListNfseEmissoes(): Promise<(NfseEmissaoDetail & { clientId: string })[]> {
  const res = await apiFetch("/api/nfse/admin/emissoes", {}, "accountant");
  const data = await res.json();
  return data.emissoes || [];
}

// ---------------------------------------------------------------------------
//  Formatting helpers
// ---------------------------------------------------------------------------

export function centavosToBRL(c: number | null | undefined): string {
  const v = (Number(c) || 0) / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function nfseStatusLabel(status: string): { label: string; tone: "ok" | "warn" | "danger" | "muted" } {
  switch (status) {
    case "emitida":
      return { label: "Emitida", tone: "ok" };
    case "rejeitada":
      return { label: "Rejeitada", tone: "danger" };
    case "cancelada":
      return { label: "Cancelada", tone: "muted" };
    case "processando":
      return { label: "Processando", tone: "warn" };
    default:
      return { label: "Rascunho", tone: "muted" };
  }
}
