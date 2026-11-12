// Tagged error for the NFS-e flow. The central error handler in server.ts turns
// anything with a numeric `status` into a clean 4xx with `message`; `codigo` /
// `motivo` carry a rejection returned by the Sefin Nacional so the client UI can
// show "por que a nota foi rejeitada".
//
// Same shape as the SERPRO helpers (`Object.assign(new Error, { status, reason })`).

export interface NfseErrorDebug {
  url?: string;
  httpStatus?: number;
  rawBody?: string; // corpo cru da resposta do Sefin (mensagem de erro — não sigiloso)
  headers?: Record<string, string>;
}

export class NfseError extends Error {
  status: number;
  codigo?: string;
  motivo?: string;
  reason?: string;
  debug?: NfseErrorDebug;

  constructor(
    message: string,
    opts: {
      status?: number;
      codigo?: string;
      motivo?: string;
      reason?: string;
      debug?: NfseErrorDebug;
    } = {},
  ) {
    super(message);
    this.name = "NfseError";
    this.status = opts.status ?? 400;
    this.codigo = opts.codigo;
    this.motivo = opts.motivo;
    this.reason = opts.reason;
    this.debug = opts.debug;
  }
}

export function notConfigured(msg = "Emissão de NFS-e não configurada para este cliente."): NfseError {
  return new NfseError(msg, { status: 400, reason: "not_configured" });
}

export function certMissing(
  msg = "Certificado digital não encontrado. Reenvie o arquivo .pfx/.p12 nas configurações de NFS-e.",
): NfseError {
  return new NfseError(msg, { status: 400, reason: "cert_missing" });
}
