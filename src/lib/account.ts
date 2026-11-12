import { apiFetch } from "./apiClient";

// Exclusão de conta do cliente.
//
// A App Store (5.1.1(v)) e o Data safety do Google exigem um caminho de
// exclusão DENTRO do app — "fale com o suporte" não passa. Mas um escritório
// de contabilidade tem guarda legal dos documentos fiscais, então o desenho
// aceito é: o cliente registra o pedido pelo app, o app explica a retenção, e
// o contador executa quando as obrigações estiverem encerradas.

export interface DeletionState {
  requested: boolean;
  requestedAt: string | null;
  reason: string | null;
}

export async function getDeletionState(): Promise<DeletionState> {
  const res = await apiFetch("/api/client/account/deletion");
  const data = await res.json().catch(() => ({}));
  return {
    requested: !!data.requested,
    requestedAt: data.requestedAt ?? null,
    reason: data.reason ?? null,
  };
}

export async function requestDeletion(
  reason: string,
): Promise<{ ok: boolean; requestedAt?: string; error?: string }> {
  const res = await apiFetch("/api/client/account/deletion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok
    ? { ok: true, requestedAt: data.requestedAt }
    : { ok: false, error: data.error || "Não foi possível registrar o pedido." };
}

export async function cancelDeletion(): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch("/api/client/account/deletion", { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: data.error || "Não foi possível cancelar." };
}
