// NFS-e (Nota Fiscal de Serviço eletrônica) — integração direta com o Sistema
// Nacional NFS-e (Sefin Nacional / gov.br), layout DPS v1.00/v1.01.
//
//   status.ts     — gating (certificado + atividade ativa + switch)
//   cert.ts       — certificado A1 do cliente: PKCS#12, agente mTLS, PEM p/ assinar
//   inscricao.ts  — CNPJ/CPF como STRING (CNPJ alfanumérico — NT-009)
//   config.ts     — CRUD de nfse_config + nfse_atividades (painel do contador)
//   dps.ts        — monta o XML da DPS (TCInfDPS)
//   validate.ts   — validação estrutural do XML (E1228/E1229/E1235/E1260)
//   sign.ts       — assinatura XMLDSig enveloped (infDPS / infPedReg)
//   client.ts     — HTTP mTLS: emitir(201) / consultar / dps / eventos / danfse / params
//   params.ts     — cache dos parâmetros municipais (ADN /parametrizacao)
//   emitir.ts     — orquestra a emissão e persiste em nfse_emissoes
//   reconcile.ts  — promove 'processando' → 'emitida'/'rejeitada' (GET /dps + /nfse)
//   events.ts     — cancelamento (evento e101101)
//   nfseXml.ts    — lê o XML da NFS-e devolvido pelo Sefin
//   danfse.ts / danfseRender.ts — DANFSe local a partir do XML (NT-008)
//   chave.ts      — parse da chave de acesso (50 posições)
//   cnpjLookup.ts — consulta de CNPJ do tomador (BrasilAPI / ReceitaWS)
//   log.ts        — log técnico sem dados sensíveis

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

export { listEmissoes, getEmissao, listAllEmissoes, getEmissaoById } from "./emissoes";

export { lookupCnpj, type TomadorLookup, type TomadorEndereco } from "./cnpjLookup";

export {
  loadClientCertContext,
  parsePfx,
  cnpjRaizMatches,
  clearAgentCache,
  type ParsedCert,
  type ClientCertContext,
} from "./cert";

export {
  normalizeInscricao,
  isCnpj,
  isCpf,
  tipoInscricao,
  isChaveAcesso,
  inscricaoRaizMatches,
} from "./inscricao";

export { emitirNfse, type EmitirInput } from "./emitir";
export { reconcileEmissao, pendingEmissoes } from "./reconcile";
export { cancelarNfse } from "./events";
export { getDanfsePdfPath } from "./danfse";
export { renderDanfsePdf } from "./danfseRender";
export { getConvenio, getAliquotaParametrizada, clearParamsCache } from "./params";
export { parseChaveAcesso, type ChaveInfo } from "./chave";
export { parseNfseXml, type NfseXmlInfo } from "./nfseXml";

export { buildDpsXml, buildDpsId, DPS_VERSAO, type BuildDpsInput } from "./dps";
export { signDps, signEnveloped } from "./sign";
export { validateDps, validatePedRegEvento } from "./validate";
export {
  gzipB64,
  ungzipB64,
  sefinBase,
  paramBase,
  danfseBase,
  type Ambiente,
} from "./client";
export { nfseLog } from "./log";

export { NfseError, notConfigured, certMissing } from "./errors";
