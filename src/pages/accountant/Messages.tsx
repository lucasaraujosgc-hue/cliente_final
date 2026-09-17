import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MessageSquare, Send, Loader2, ExternalLink, Inbox } from "lucide-react";
import { format, parseISO, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  listConversations,
  getConversation,
  replyToClient,
  markConversationRead,
  type Conversation,
  type Message,
} from "../../lib/messages";

// Caixa de entrada única das mensagens dos clientes. Antes a thread só existia
// dentro de /admin/client/:id — se três clientes escrevessem, o contador não
// ficava sabendo de nenhum.
export function AccountantMessages() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("cliente");

  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [thread, setThread] = useState<Message[] | null>(null);
  const [clientName, setClientName] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [erro, setErro] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const loadConvs = async () => setConvs(await listConversations().catch(() => []));

  useEffect(() => {
    void loadConvs();
  }, []);

  useEffect(() => {
    if (!selected) {
      setThread(null);
      setClientName("");
      return;
    }
    let alive = true;
    (async () => {
      setThread(null);
      const { client, messages } = await getConversation(selected);
      if (!alive) return;
      setClientName(client?.name || "Cliente");
      setThread(messages);
      await markConversationRead(selected);
      await loadConvs();
      window.dispatchEvent(new CustomEvent("accountant-messages-read"));
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.length]);

  const responder = async (e: FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content || !selected || sending) return;
    setSending(true);
    setErro("");
    const r = await replyToClient(selected, content);
    if (r.ok) {
      setText("");
      const { messages } = await getConversation(selected);
      setThread(messages);
      await loadConvs();
    } else {
      setErro(r.error || "Não foi possível enviar.");
    }
    setSending(false);
  };

  const totalUnread = (convs || []).reduce((n, c) => n + c.unread, 0);

  return (
    <div className="space-y-6 animate-in fade-in">
      <header className="h-16 flex items-center justify-between px-8 bg-white/40 dark:bg-slate-900/30 backdrop-blur-md border border-white dark:border-slate-800 rounded-2xl shadow-sm">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Mensagens</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {totalUnread > 0
              ? `${totalUnread} mensagem(ns) de cliente aguardando resposta.`
              : "Conversas com os clientes do escritório."}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* lista de conversas */}
        <div className="bg-white/80 dark:bg-slate-900/70 backdrop-blur-xl border border-white dark:border-slate-800 rounded-3xl overflow-hidden shadow-xl shadow-slate-200/50 dark:shadow-slate-950/50">
          <div className="px-5 py-4 border-b border-white dark:border-slate-800 bg-white/50 dark:bg-slate-900/40 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 dark:text-white">Conversas</h3>
            <Inbox className="w-5 h-5 text-slate-400 dark:text-slate-500" />
          </div>
          <div className="divide-y divide-slate-100/50 dark:divide-slate-800/50 max-h-[70vh] overflow-y-auto">
            {convs === null && (
              <p className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">Carregando…</p>
            )}
            {convs?.length === 0 && (
              <p className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Nenhuma conversa ainda.
              </p>
            )}
            {convs?.map((c) => {
              const active = c.clientId === selected;
              return (
                <button
                  key={c.clientId}
                  onClick={() => setParams({ cliente: c.clientId })}
                  className={
                    "w-full text-left px-5 py-3.5 transition-colors " +
                    (active
                      ? "bg-indigo-50 dark:bg-indigo-900/20"
                      : "hover:bg-white dark:hover:bg-slate-800/60")
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {c.clientName}
                    </span>
                    {c.unread > 0 && (
                      <span className="shrink-0 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                        {c.unread}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                    {c.lastDirection === "client_to_accountant" ? "" : "Você: "}
                    {c.lastMessage}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
                    {format(parseISO(c.lastAt), "dd/MM/yyyy HH:mm")}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* thread */}
        <div className="lg:col-span-2 bg-white/80 dark:bg-slate-900/70 backdrop-blur-xl border border-white dark:border-slate-800 rounded-3xl overflow-hidden shadow-xl shadow-slate-200/50 dark:shadow-slate-950/50 flex flex-col">
          {!selected ? (
            <div className="flex-1 grid place-items-center p-12 text-center">
              <div>
                <MessageSquare className="mx-auto w-8 h-8 text-slate-300 dark:text-slate-600" />
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                  Escolha uma conversa ao lado.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-5 py-4 border-b border-white dark:border-slate-800 bg-white/50 dark:bg-slate-900/40 flex items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-800 dark:text-white truncate">{clientName}</h3>
                <Link
                  to={`/admin/client/${selected}`}
                  className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  Abrir cliente <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>

              <div className="flex-1 min-h-[45vh] max-h-[60vh] overflow-y-auto px-5 py-5 space-y-4">
                {thread === null && (
                  <p className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">Carregando…</p>
                )}
                {thread?.map((m, i) => {
                  const mine = m.direction !== "client_to_accountant";
                  const at = parseISO(m.createdAt);
                  const prev = i > 0 ? parseISO(thread[i - 1].createdAt) : null;
                  const newDay = !prev || !isSameDay(prev, at);
                  return (
                    <div key={m.id}>
                      {newDay && (
                        <p className="mb-4 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          {format(at, "d 'de' MMMM", { locale: ptBR })}
                        </p>
                      )}
                      <div className={mine ? "flex justify-end" : "flex justify-start"}>
                        <div
                          className={
                            "max-w-[80%] rounded-2xl px-4 py-2.5 " +
                            (mine
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100")
                          }
                        >
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {m.content}
                          </p>
                          <p
                            className={
                              "mt-1 text-[10px] tabular-nums " +
                              (mine ? "text-white/70" : "text-slate-400 dark:text-slate-500")
                            }
                          >
                            {mine ? "Você" : clientName} · {format(at, "HH:mm")}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>

              <form
                onSubmit={responder}
                className="border-t border-white dark:border-slate-800 bg-white/50 dark:bg-slate-900/40 p-4"
              >
                {erro && <p className="mb-2 text-xs font-medium text-rose-600 dark:text-rose-400">{erro}</p>}
                <div className="flex items-end gap-2">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, 5000))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void responder(e as unknown as FormEvent);
                      }
                    }}
                    rows={1}
                    placeholder="Responder…"
                    className="max-h-32 min-h-[44px] flex-1 resize-y rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={sending || !text.trim()}
                    className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-40"
                    title="Enviar"
                  >
                    {sending ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Send className="w-[18px] h-[18px]" />}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
