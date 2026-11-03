import { apiFetch } from "./apiClient";
import type { ServicoLC116 } from "./listaServicosLC116";

// Quem chama: o próprio cliente (app) ou o contador agindo por ele.
type Quem = "client" | "accountant";

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
  origem: "sistema" | "distribuicao";
  papel: "prestador" | "tomador" | "intermediario";
  prestadorNome: string | null;
  prestadorDoc: string | null;
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
  idDps: string | null;
  nsu: number | null;
  rejeicaoCodigo: string | null;
  erroMsg: string | null;
  alertas: { codigo: string | null; mensagem: string | null }[] | null;
  versaoAplicativo: string | null;
  cancelamentoMotivo: string | null;
  hasDanfse: boolean;
  hasXmlDps: boolean;
  hasXmlNfse: boolean;
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
  pTotTribSn: number | null;
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
  usarProcuracao: boolean; // emite com o certificado do escritório (procuração RFB)
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
  usarProcuracao?: boolean;
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
  exigeTomadorCnpj?: boolean; // ISS retido / 17.05.01 → a nota exige tomador com CNPJ
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

// NFS-e de serviço tomado (o cliente é o tomador), trazidas do portal nacional.
export async function listTomados(): Promise<NfseEmissao[]> {
  const res = await apiFetch("/api/nfse/tomados");
  const data = await res.json();
  return data.tomados || [];
}

export async function getEmissao(id: string): Promise<NfseEmissaoDetail> {
  const res = await apiFetch(`/api/nfse/emissoes/${id}`);
  const data = await res.json();
  return data.emissao;
}

export async function lookupCnpjTomador(cnpj: string, url = "/api/nfse/lookup-cnpj", quem: Quem = "client"): Promise<TomadorLookup> {
  const res = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cnpj }),
  }, quem);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Falha ao consultar o CNPJ.");
  return data.tomador;
}

export interface CepEndereco {
  cep: string;
  logradouro: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  codigoMunicipio: string | null;
}

export async function lookupCepTomador(cep: string, url = "/api/nfse/lookup-cep", quem: Quem = "client"): Promise<CepEndereco> {
  const res = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cep }),
  }, quem);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Falha ao consultar o CEP.");
  return data.endereco;
}

// A DPS só aceita o endereço do tomador completo — e ele é obrigatório quando o
// tomador é identificado por CNPJ (rejeição E0235).
export function enderecoCompleto(e?: NfseEndereco | null): boolean {
  const d = (v?: string | null) => String(v ?? "").replace(/\D/g, "");
  const t = (v?: string | null) => String(v ?? "").trim();
  return !!e && d(e.cep).length === 8 && d(e.codigoMunicipio).length === 7 && !!t(e.logradouro) && !!t(e.numero) && !!t(e.bairro);
}

export interface EmitirNfseInput {
  atividadeId: string;
  // CNPJ, CPF (+ nome) ou null = sem tomador. Sem endereço/telefone/e-mail.
  tomador: { doc: string; nome: string } | null;
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

export async function emitirNfse(input: EmitirNfseInput, url = "/api/nfse/emissoes", quem: Quem = "client"): Promise<EmitirNfseResult> {
  const res = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, quem);
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
    const campos = Array.isArray(data.details)
      ? data.details.map((d: { field: string; message: string }) => `${d.field}: ${d.message}`).join("; ")
      : "";
    return {
      ok: false,
      error: data.error || "Falha ao emitir a nota.",
      codigo: data.codigo,
      motivo: [data.motivo, campos].filter(Boolean).join(" — ") || undefined,
    };
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
export async function sincronizarEmissao(id: string, base = "/api/nfse/emissoes", quem: Quem = "client"): Promise<SincronizarResult> {
  const res = await apiFetch(`${base}/${id}/sincronizar`, { method: "POST" }, quem);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || "Falha ao consultar o Sefin." };
  return { ok: true, ...data };
}

export interface DistribuicaoResult {
  ok: boolean;
  novas?: number;
  novasTomadas?: number;
  atualizadas?: number;
  eventos?: number;
  ultimoNsu?: number;
  error?: string;
}

// Busca no portal nacional as NFS-e do prestador não emitidas por aqui.
export async function sincronizarDistribuicao(): Promise<DistribuicaoResult> {
  const res = await apiFetch("/api/nfse/sincronizar-dfe", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || data.motivo || "Falha ao consultar o portal nacional." };
  return { ok: true, ...data };
}

export async function adminSincronizarDistribuicao(
  clientId: string,
  reiniciar = false,
): Promise<DistribuicaoResult> {
  const qs = reiniciar ? "?reiniciar=1" : "";
  const res = await apiFetch(
    `/api/nfse/admin/clients/${clientId}/sincronizar-dfe${qs}`,
    { method: "POST" },
    "accountant",
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || data.motivo || "Falha ao consultar o portal nacional." };
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

// Apaga uma tentativa rejeitada (nunca virou documento fiscal).
export async function excluirEmissao(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch(`/api/nfse/emissoes/${id}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: data.error || "Falha ao excluir." };
}

export async function limparRejeitadas(): Promise<{ ok: boolean; removidas?: number; error?: string }> {
  const res = await apiFetch("/api/nfse/emissoes/limpar-rejeitadas", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, removidas: data.removidas } : { ok: false, error: data.error || "Falha ao limpar." };
}

export async function adminExcluirEmissao(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch(`/api/nfse/admin/emissoes/${id}`, { method: "DELETE" }, "accountant");
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: data.error || "Falha ao excluir." };
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
export async function fetchDanfseBlob(id: string, base = "/api/nfse/emissoes", quem: Quem = "client"): Promise<Blob> {
  const res = await apiFetch(`${base}/${id}/danfse`, {}, quem);
  if (!res.ok) throw new Error("Não foi possível obter o PDF da nota.");
  return res.blob();
}

// `nome`: nome legível do arquivo, sem ".pdf" (ver nomeArquivoNfse em
// lib/filtroNotas.ts) — "NFS-e 43 - TOMADOR - 02-11-2026", nunca o id.
const arquivoPdf = (nome?: string | null) => `${(nome || "NFS-e").trim()}.pdf`;

export async function viewDanfse(id: string, nome?: string | null, base?: string, quem: Quem = "client"): Promise<void> {
  const blob = await fetchDanfseBlob(id, base, quem);
  const arquivo = arquivoPdf(nome);
  const { isNativeApp, shareNativeBlob } = await import("./native");
  if (isNativeApp()) {
    if (await shareNativeBlob(blob, arquivo)) return;
  }
  const url = URL.createObjectURL(new File([blob], arquivo, { type: "application/pdf" }));
  // Abre numa aba com o nome da nota no título (o endereço de um blob seria só
  // um código aleatório). O botão "Baixar" das listas salva com esse nome.
  const w = window.open("", "_blank");
  if (w) {
    w.document.title = arquivo.replace(/\.pdf$/, "");
    w.document.body.style.margin = "0";
    const frame = w.document.createElement("iframe");
    frame.src = url;
    frame.title = w.document.title;
    frame.setAttribute("style", "border:0;width:100vw;height:100vh;display:block");
    w.document.body.appendChild(frame);
  } else {
    baixarBlob(blob, arquivo);
  }
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
}

function baixarBlob(blob: Blob, arquivo: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = arquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Baixa o PDF com o nome legível da nota. */
export async function baixarDanfse(id: string, nome?: string | null, base?: string, quem: Quem = "client"): Promise<void> {
  const blob = await fetchDanfseBlob(id, base, quem);
  const arquivo = arquivoPdf(nome);
  const { isNativeApp, shareNativeBlob } = await import("./native");
  if (isNativeApp() && (await shareNativeBlob(blob, arquivo))) return;
  baixarBlob(blob, arquivo);
}

export async function shareDanfse(id: string, nome?: string | null, base?: string, quem: Quem = "client"): Promise<"shared" | "downloaded"> {
  const blob = await fetchDanfseBlob(id, base, quem);
  const filename = arquivoPdf(nome);
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
  baixarBlob(blob, filename);
  return "downloaded";
}

// ---------------------------------------------------------------------------
//  Assistente de emissão: o cliente (padrão) ou o contador emitindo por ele
// ---------------------------------------------------------------------------

export interface NfseEmitApi {
  lookupCnpj: (cnpj: string) => Promise<TomadorLookup>;
  lookupCep: (cep: string) => Promise<CepEndereco>;
  emitir: (input: EmitirNfseInput) => Promise<EmitirNfseResult>;
  sincronizar: (id: string) => Promise<SincronizarResult>;
  // `nome`: nome legível do PDF (nomeArquivoNfse), sem ".pdf".
  verDanfse: (id: string, nome?: string | null) => Promise<void>;
  baixarDanfse: (id: string, nome?: string | null) => Promise<void>;
  compartilharDanfse: (id: string, nome?: string | null) => Promise<"shared" | "downloaded">;
}

export const nfseApiCliente: NfseEmitApi = {
  lookupCnpj: (cnpj) => lookupCnpjTomador(cnpj),
  lookupCep: (cep) => lookupCepTomador(cep),
  emitir: (input) => emitirNfse(input),
  sincronizar: (id) => sincronizarEmissao(id),
  verDanfse: (id, nome) => viewDanfse(id, nome),
  baixarDanfse: (id, nome) => baixarDanfse(id, nome),
  compartilharDanfse: (id, nome) => shareDanfse(id, nome),
};

/** O contador emite em nome do cliente (registrado na auditoria como dele). */
export function nfseApiContador(clientId: string): NfseEmitApi {
  const base = "/api/nfse/admin/emissoes";
  return {
    lookupCnpj: (cnpj) => lookupCnpjTomador(cnpj, "/api/nfse/admin/lookup-cnpj", "accountant"),
    lookupCep: (cep) => lookupCepTomador(cep, "/api/nfse/admin/lookup-cep", "accountant"),
    emitir: (input) => emitirNfse(input, `/api/nfse/admin/clients/${clientId}/emissoes`, "accountant"),
    sincronizar: (id) => sincronizarEmissao(id, base, "accountant"),
    verDanfse: (id, nome) => viewDanfse(id, nome, base, "accountant"),
    baixarDanfse: (id, nome) => baixarDanfse(id, nome, base, "accountant"),
    compartilharDanfse: (id, nome) => shareDanfse(id, nome, base, "accountant"),
  };
}

// ---------------------------------------------------------------------------
//  Accountant-facing API (/api/nfse/admin/*)
// ---------------------------------------------------------------------------

export interface AdminNotasCliente {
  habilitado: boolean;
  motivo: "sem_config" | "sem_certificado" | "inativo" | "sem_atividade" | null;
  ambiente: string | null;
  atividades: NfseAtividadeCliente[];
  emitidas: NfseEmissao[];
  tomadas: NfseEmissao[];
}

// Lote "configurar por procuração e buscar notas de todos" (services/nfse/lote.ts).
export interface LoteResultadoCliente {
  clientId: string;
  nome: string;
  acao: "configurado" | "procuracao_ligada" | "mantido" | null;
  municipio: string | null;
  notasNovas: number;
  tomadasNovas: number;
  mesesFaturamento: number;
  divergentes: number;
  erro: string | null;
}
export interface LoteEstado {
  emAndamento: boolean;
  inicio: string;
  fim: string | null;
  total: number;
  feitos: number;
  resultados: LoteResultadoCliente[];
}
export async function adminIniciarLoteProcuracao(): Promise<LoteEstado> {
  const res = await apiFetch("/api/nfse/admin/lote/procuracao", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, "accountant");
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) throw new Error(data.error || "Falha ao iniciar.");
  return data.estado;
}
export async function adminEstadoLoteProcuracao(): Promise<LoteEstado | null> {
  const res = await apiFetch("/api/nfse/admin/lote/procuracao", {}, "accountant");
  const data = await res.json().catch(() => ({}));
  return data.estado ?? null;
}

export async function adminGetNotasCliente(clientId: string): Promise<AdminNotasCliente> {
  const res = await apiFetch(`/api/nfse/admin/clients/${clientId}/notas`, {}, "accountant");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Falha ao carregar as notas do cliente.");
  return data;
}

export async function adminListNfseClients(): Promise<NfseClientOverview[]> {
  const res = await apiFetch("/api/nfse/admin/clients", {}, "accountant");
  const data = await res.json();
  return data.clients || [];
}

export interface AdminClientNfse {
  client: { id: string; name: string; cnpj: string; cnpjFormatado: string };
  config: NfseAdminConfig | null;
  atividades: NfseAtividade[];
  // Certificado do escritório (Integra Contador), usado por procuração.
  certEscritorio: { cnpj: string | null; validadeAte: string; vencido: boolean } | null;
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
  procuracao?: boolean;
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

// Baixa o XML da DPS assinada ou da NFS-e de uma emissão (diagnóstico).
export async function adminDownloadEmissaoXml(id: string, tipo: "dps" | "nfse"): Promise<void> {
  const res = await apiFetch(`/api/nfse/admin/emissoes/${id}/xml?tipo=${tipo}`, {}, "accountant");
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || "XML não disponível.");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${tipo}-${id}.xml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
