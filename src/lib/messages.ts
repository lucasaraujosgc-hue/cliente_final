import { apiFetch } from "./apiClient";

// Mensagens entre cliente e escritório. A tabela `messages` sempre existiu com
// as duas direções e o contador já via a thread dentro de ClientDetail; o que
// faltava era o cliente poder responder e o contador ter uma caixa de entrada
// única (antes só descobria a mensagem abrindo o cliente).

export type MessageDirection = "accountant_to_client" | "client_to_accountant";

export interface Message {
  id: string;
  content: string;
  direction: MessageDirection;
  read: boolean;
  createdAt: string;
}

export interface Conversation {
  clientId: string;
  clientName: string;
  clientCnpj: string | null;
  lastMessage: string;
  lastDirection: MessageDirection;
  lastAt: string;
  unread: number;
  total: number;
}

// ---------------------------------------------------------------- cliente ---

export async function listClientMessages(): Promise<Message[]> {
  const res = await apiFetch("/api/client/messages");
  const data = await res.json().catch(() => ({}));
  return data.messages || [];
}

export async function sendClientMessage(content: string): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch("/api/client/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: data.error || "Não foi possível enviar." };
}

export async function markClientMessagesRead(): Promise<void> {
  await apiFetch("/api/client/messages/read", { method: "POST" }).catch(() => {});
}

// --------------------------------------------------------------- contador ---

export async function listConversations(): Promise<Conversation[]> {
  const res = await apiFetch("/api/accountant/messages", {}, "accountant");
  const data = await res.json().catch(() => ({}));
  return data.conversations || [];
}

export async function getConversation(
  clientId: string,
): Promise<{ client: { id: string; name: string; cnpj: string } | null; messages: Message[] }> {
  const res = await apiFetch(`/api/accountant/messages/${clientId}`, {}, "accountant");
  const data = await res.json().catch(() => ({}));
  return { client: data.client ?? null, messages: data.messages || [] };
}

export async function replyToClient(
  clientId: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch(
    "/api/accountant/message",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, content }),
    },
    "accountant",
  );
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: data.error || "Não foi possível enviar." };
}

export async function markConversationRead(clientId: string): Promise<void> {
  await apiFetch(
    "/api/accountant/messages/read",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    },
    "accountant",
  ).catch(() => {});
}
