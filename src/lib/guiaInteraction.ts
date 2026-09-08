import { apiFetch } from "./apiClient";

export type GuiaInteractionType = "view" | "copy_pix" | "copy_barcode";

// Fire-and-forget: tells the backend the client just opened / copied a guia so
// it can schedule a payment check for the next day. Never blocks the user
// action and never surfaces an error — the copy/open must always work.
export function registerGuiaInteraction(
  documentId: string,
  type: GuiaInteractionType,
): void {
  if (!documentId) return;
  void apiFetch(`/api/client/guia/${documentId}/interaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  }).catch(() => {
    /* best-effort */
  });
}
