import { describe, it, expect } from "vitest";
import { buildConversations, type ClientRow, type MessageRow } from "../messages";

const CLIENTS: ClientRow[] = [
  { id: "a", name: "Padaria do Zé", cnpj: "12345678000199" },
  { id: "b", name: "Clínica Bem-Estar", cnpj: "98765432000111" },
];

const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

const msg = (
  clientId: string,
  direction: string,
  read: boolean,
  daysAgo: number,
  content = "…",
): MessageRow => ({ clientId, direction, read, createdAt: at(daysAgo), content });

describe("buildConversations", () => {
  it("agrupa por cliente e conta só as não lidas que vieram do cliente", () => {
    const [conv] = buildConversations(CLIENTS, [
      msg("a", "accountant_to_client", false, 3), // não lida, mas é minha -> não conta
      msg("a", "client_to_accountant", false, 2),
      msg("a", "client_to_accountant", false, 1),
      msg("a", "client_to_accountant", true, 4),
    ]);
    expect(conv.clientId).toBe("a");
    expect(conv.total).toBe(4);
    expect(conv.unread).toBe(2);
  });

  it("usa a mensagem mais recente como prévia, mesmo fora de ordem", () => {
    const [conv] = buildConversations(CLIENTS, [
      msg("a", "client_to_accountant", true, 1, "mais nova"),
      msg("a", "accountant_to_client", true, 9, "mais velha"),
      msg("a", "accountant_to_client", true, 5, "do meio"),
    ]);
    expect(conv.lastMessage).toBe("mais nova");
    expect(conv.lastDirection).toBe("client_to_accountant");
  });

  it("ordena: não lidas primeiro, depois a conversa mais recente", () => {
    const out = buildConversations(CLIENTS, [
      msg("a", "accountant_to_client", true, 0, "hoje, tudo lido"),
      msg("b", "client_to_accountant", false, 8, "antiga mas não lida"),
    ]);
    expect(out.map((c) => c.clientId)).toEqual(["b", "a"]);
  });

  it("não inventa conversa para cliente que nunca trocou mensagem", () => {
    const out = buildConversations(CLIENTS, [msg("a", "client_to_accountant", false, 1)]);
    expect(out).toHaveLength(1);
  });

  it("sobrevive a mensagem órfã (cliente apagado)", () => {
    const [conv] = buildConversations(CLIENTS, [msg("zzz", "client_to_accountant", false, 1)]);
    expect(conv.clientName).toBe("Cliente removido");
    expect(conv.clientCnpj).toBeNull();
  });

  it("lista vazia não quebra", () => {
    expect(buildConversations(CLIENTS, [])).toEqual([]);
  });
});
