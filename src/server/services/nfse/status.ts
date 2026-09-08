import { and, count, eq } from "drizzle-orm";
import { db } from "../../db";
import { nfseConfig, nfseAtividades } from "../../schema";

// When emission is expected to be broadly available. Clients without a full
// setup keep seeing this date (the existing "a partir de novembro/2026" card).
export const NFSE_AVAILABLE_FROM = "2026-11-01";

export function nfseUnavailableMessage(): string {
  return "A emissão de Nota de Serviço estará disponível a partir de novembro/2026.";
}

export type NfseDisabledReason =
  | "sem_config"
  | "sem_certificado"
  | "sem_atividade"
  | "inativo";

export interface NfseClientStatus {
  enabled: boolean;
  ambiente: string | null;
  availableFrom: string;
  message: string;
  motivo?: NfseDisabledReason;
  codigoMunicipio?: string | null;
  regimeTributario?: string | null;
}

// The gate: the client only sees the emitter when the accountant has uploaded a
// certificate, configured at least one active activity, AND flipped the switch.
// Every other state returns the same "novembro/2026" message.
export async function nfseStatusForClient(clientId: string): Promise<NfseClientStatus> {
  const disabled = (motivo: NfseDisabledReason): NfseClientStatus => ({
    enabled: false,
    ambiente: null,
    availableFrom: NFSE_AVAILABLE_FROM,
    message: nfseUnavailableMessage(),
    motivo,
  });

  const [config] = await db.select().from(nfseConfig).where(eq(nfseConfig.clientId, clientId));
  if (!config) return disabled("sem_config");
  if (!config.certPath) return disabled("sem_certificado");
  if (!config.ativo) return disabled("inativo");

  const [{ n }] = await db
    .select({ n: count() })
    .from(nfseAtividades)
    .where(and(eq(nfseAtividades.clientId, clientId), eq(nfseAtividades.ativo, true)));
  if (Number(n) === 0) return disabled("sem_atividade");

  return {
    enabled: true,
    ambiente: config.ambiente,
    availableFrom: NFSE_AVAILABLE_FROM,
    message: "",
    codigoMunicipio: config.codigoMunicipio ?? null,
    regimeTributario: config.regimeTributario,
  };
}

// Legacy shape kept for the old scaffold callers until routes are updated.
export function nfseStatus() {
  return {
    enabled: false,
    availableFrom: NFSE_AVAILABLE_FROM,
    message: nfseUnavailableMessage(),
  };
}
