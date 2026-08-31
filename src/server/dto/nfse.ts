import type { NfseConfigRow, NfseAtividadeRow, NfseEmissaoRow } from "../types";

// Response shapes for the NFS-e tables. NEVER spread a raw nfse_config row into
// a response — it carries cert_path and the (encrypted) cert_senha. The client
// never receives cert/config internals at all; the accountant panel only learns
// *whether* a certificate is present and its CNPJ/expiry.

export function nfseConfigDTO(c: NfseConfigRow | null, certExists: boolean) {
  if (!c) return null;
  return {
    id: c.id,
    ativo: c.ativo,
    ambiente: c.ambiente,
    hasCert: certExists,
    certMissing: !!c.certPath && !certExists,
    certCnpj: c.certCnpj ?? null,
    certValidadeAte: c.certValidadeAte ?? null,
    hasCertSenha: !!c.certSenha,
    codigoMunicipio: c.codigoMunicipio ?? null,
    regimeTributario: c.regimeTributario,
    regimeEspecialTrib: c.regimeEspecialTrib ?? null,
    optanteSimplesNacional: c.optanteSimplesNacional,
    incentivoFiscal: c.incentivoFiscal,
    serieDps: c.serieDps,
    proxNumeroDps: c.proxNumeroDps,
    updatedAt: c.updatedAt,
  };
}

// Everything the accountant edits about one activity.
export function nfseAtividadeAdminDTO(a: NfseAtividadeRow) {
  return {
    id: a.id,
    nome: a.nome,
    itemListaServico: a.itemListaServico,
    codTributacaoNac: a.codTributacaoNac ?? null,
    codTributacaoMun: a.codTributacaoMun ?? null,
    cnae: a.cnae ?? null,
    descricaoPadrao: a.descricaoPadrao,
    aliquotaIss: a.aliquotaIss,
    issRetido: a.issRetido,
    exigibilidadeIss: a.exigibilidadeIss,
    municipioIncidencia: a.municipioIncidencia ?? null,
    retIrrf: a.retIrrf,
    retPis: a.retPis,
    retCofins: a.retCofins,
    retCsll: a.retCsll,
    retInss: a.retInss,
    ativo: a.ativo,
    ordem: a.ordem,
  };
}

// What the client's emission wizard needs to show / pick an activity.
export function nfseAtividadeClientDTO(a: NfseAtividadeRow) {
  return {
    id: a.id,
    nome: a.nome,
    itemListaServico: a.itemListaServico,
    descricaoPadrao: a.descricaoPadrao,
    aliquotaIss: a.aliquotaIss,
    issRetido: a.issRetido,
  };
}

// One row in the "Notas emitidas" list.
export function nfseEmissaoListDTO(e: NfseEmissaoRow) {
  return {
    id: e.id,
    status: e.status,
    tomadorNome: e.tomadorNome ?? null,
    tomadorDoc: e.tomadorDoc ?? null,
    valorServicos: e.valorServicos ?? null,
    numeroNota: e.numeroNota ?? null,
    chaveAcesso: e.chaveAcesso ?? null,
    dataEmissao: e.dataEmissao ?? null,
    createdAt: e.createdAt,
    rejeicaoMotivo: e.rejeicaoMotivo ?? null,
    canceladaEm: e.canceladaEm ?? null,
  };
}

// Detail — also drives "duplicar nota" (prefills tomador + activity + description).
export function nfseEmissaoDetailDTO(e: NfseEmissaoRow) {
  return {
    ...nfseEmissaoListDTO(e),
    atividadeId: e.atividadeId ?? null,
    ambiente: e.ambiente ?? null,
    competencia: e.competencia ?? null,
    descricao: e.descricao ?? null,
    aliquotaIss: e.aliquotaIss ?? null,
    valorIss: e.valorIss ?? null,
    serieDps: e.serieDps ?? null,
    numeroDps: e.numeroDps ?? null,
    tomadorEmail: e.tomadorEmail ?? null,
    tomadorTelefone: e.tomadorTelefone ?? null,
    tomadorEndereco: e.tomadorEndereco ?? null,
    rejeicaoCodigo: e.rejeicaoCodigo ?? null,
    cancelamentoMotivo: e.cancelamentoMotivo ?? null,
    hasDanfse: !!e.danfsePdfPath || (e.status === "emitida" && !!e.chaveAcesso),
  };
}
