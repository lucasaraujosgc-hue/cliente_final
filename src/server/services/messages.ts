// Agregação da caixa de entrada de mensagens do contador.
//
// A tabela `messages` é uma lista plana (clientId, direction, read, createdAt).
// A tela precisa de uma linha por cliente, com a última mensagem e quantas do
// cliente ainda não foram lidas — e as não lidas no topo, senão a caixa de
// entrada não serve pra nada.

export type MessageDirection = "accountant_to_client" | "client_to_accountant";

export interface MessageRow {
  clientId: string;
  content: string;
  direction: string;
  read: boolean;
  createdAt: Date | string;
}

export interface ClientRow {
  id: string;
  name: string;
  cnpj: string;
}

export interface Conversation {
  clientId: string;
  clientName: string;
  clientCnpj: string | null;
  lastMessage: string;
  lastDirection: MessageDirection;
  lastAt: Date | string;
  unread: number;
  total: number;
}

const ts = (v: Date | string) => new Date(v).getTime();

export function buildConversations(
  clientRows: ClientRow[],
  messageRows: MessageRow[],
): Conversation[] {
  const byId = new Map(clientRows.map((c) => [c.id, c]));

  const grouped = new Map<string, MessageRow[]>();
  for (const m of messageRows) {
    const arr = grouped.get(m.clientId);
    if (arr) arr.push(m);
    else grouped.set(m.clientId, [m]);
  }

  const out: Conversation[] = [];
  for (const [clientId, msgs] of grouped) {
    // não confia na ordem que veio do banco
    const last = msgs.reduce((a, b) => (ts(b.createdAt) >= ts(a.createdAt) ? b : a));
    const c = byId.get(clientId);
    out.push({
      clientId,
      clientName: c?.name ?? "Cliente removido",
      clientCnpj: c?.cnpj ?? null,
      lastMessage: last.content,
      lastDirection: last.direction as MessageDirection,
      lastAt: last.createdAt,
      unread: msgs.filter((m) => m.direction === "client_to_accountant" && !m.read).length,
      total: msgs.length,
    });
  }

  // não lidas primeiro; depois conversa mais recente
  return out.sort((a, b) => b.unread - a.unread || ts(b.lastAt) - ts(a.lastAt));
}
