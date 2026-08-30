import { apiFetch } from "./apiClient";

export interface NfseStatus {
  enabled: boolean;
  availableFrom: string;
  message: string;
}

export interface NfseEmissao {
  id: string;
  status: string;
  competencia: string | null;
  valorServicos: number | null;
  descricao: string | null;
  numeroNota: string | null;
  createdAt: string;
}

export async function getNfseStatus(): Promise<NfseStatus> {
  const res = await apiFetch("/api/nfse");
  return res.json();
}

export async function listEmissoes(): Promise<NfseEmissao[]> {
  const res = await apiFetch("/api/nfse/emissoes");
  const data = await res.json();
  return data.emissoes || [];
}
