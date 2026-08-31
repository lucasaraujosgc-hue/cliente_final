// NFS-e (Nota Fiscal de Serviço eletrônica) — integração direta com o Sistema
// Nacional NFS-e (Sefin Nacional / gov.br), layout v1.01.
//
//   status.ts   — gating (certificado + atividade ativa + switch)
//   cert.ts     — certificado A1 do cliente: PKCS#12, agente mTLS, PEM p/ assinar
//   config.ts   — CRUD de nfse_config + nfse_atividades (painel do contador)
//   dps.ts      — monta o XML da DPS (TCInfDPS)
//   sign.ts     — assinatura XMLDSig enveloped (infDPS / infPedReg)
//   client.ts   — HTTP mTLS: emitir / consultar / eventos / DANFSE / parâmetros
//   params.ts   — cache dos parâmetros municipais (convênio + alíquotas)
//   emitir.ts   — orquestra a emissão e persiste em nfse_emissoes
//   events.ts   — cancelamento (evento e101101)
//   danfse.ts   — busca e cacheia o PDF da DANFSE
//   chave.ts    — parse da chave de acesso (50 dígitos) para exibição
//   cnpjLookup.ts — consulta de CNPJ do tomador (BrasilAPI / ReceitaWS)

export {
  NFSE_AVAILABLE_FROM,
  nfseStatus,
  nfseStatusForClient,
  nfseUnavailableMessage,
  type NfseClientStatus,
} from "./status";

export {
  getClientConfig,
  certFileExists,
  upsertClientConfig,
  listAtividades,
  getAtividade,
  createAtividade,
  updateAtividade,
  deleteAtividade,
  nfseClientsOverview,
  type UpsertConfigInput,
  type AtividadeInput,
  type NfseClientOverview,
} from "./config";

export { listEmissoes, getEmissao, listAllEmissoes } from "./emissoes";

export { lookupCnpj, type TomadorLookup, type TomadorEndereco } from "./cnpjLookup";

export {
  loadClientCertContext,
  parsePfx,
  cnpjRaizMatches,
  clearAgentCache,
  type ParsedCert,
  type ClientCertContext,
} from "./cert";

export { emitirNfse, type EmitirInput } from "./emitir";
export { cancelarNfse } from "./events";
export { getDanfsePdfPath } from "./danfse";
export { getConvenio, getParametrosServico, clearParamsCache } from "./params";
export { parseChaveAcesso, type ChaveInfo } from "./chave";

export { buildDpsXml, buildDpsId, type BuildDpsInput } from "./dps";
export { signDps, signEnveloped } from "./sign";
export { gzipB64, ungzipB64, sefinBase, adnBase, type Ambiente } from "./client";

export { NfseError, notConfigured, certMissing } from "./errors";
