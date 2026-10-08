import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import { format, parseISO, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  listClientMessages,
  sendClientMessage,
  markClientMessagesRead,
  type Message,
} from "../../lib/messages";

const MAX = 5000;

export function ClientMessages() {
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [erro, setErro] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const list = await listClientMessages().catch(() => []);
    setMsgs(list);
  };

  useEffect(() => {
    (async () => {
      await load();
      // abrir a conversa é o que zera o aviso no topo do Visão Geral
      await markClientMessagesRead();
      window.dispatchEvent(new CustomEvent("messages-read"));
    })();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs?.length]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setErro("");
    const r = await sendClientMessage(content);
    if (r.ok) {
      setText("");
      await load();
    } else {
      setErro(r.error || "Não foi possível enviar.");
    }
    setSending(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-serif text-[1.75rem] font-semibold leading-tight text-ink">
          Falar com o escritório
        </h1>
        <p className="mt-1 text-sm text-muted">
          Dúvidas sobre guias, documentos e prazos. O contador responde por aqui.
        </p>
      </header>

      <section className="flex h-[calc(100dvh-15rem)] min-h-[360px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5">
          {msgs === null && (
            <p className="py-10 text-center text-sm text-muted">Carregando…</p>
          )}

          {msgs?.length === 0 && (
            <div className="py-14 text-center">
              <MessageSquare className="mx-auto size-8 text-faint" strokeWidth={1.6} />
              <p className="mt-3 text-sm font-semibold text-ink">Nenhuma mensagem ainda</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
                Escreva abaixo para falar com o seu contador. As respostas dele aparecem aqui.
              </p>
            </div>
          )}

          {msgs?.map((m, i) => {
            const mine = m.direction === "client_to_accountant";
            const at = parseISO(m.createdAt);
            const prev = i > 0 ? parseISO(msgs[i - 1].createdAt) : null;
            const newDay = !prev || !isSameDay(prev, at);
            return (
              <div key={m.id}>
                {newDay && (
                  <p className="mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                    {format(at, "d 'de' MMMM", { locale: ptBR })}
                  </p>
                )}
                <div className={mine ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      "max-w-[85%] rounded-2xl px-4 py-2.5 sm:max-w-[70%] " +
                      (mine
                        ? "bg-brand text-white"
                        : "border border-line bg-sunken text-ink")
                    }
                  >
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {m.content}
                    </p>
                    <p
                      className={
                        "mt-1 text-[10px] tabular-nums " +
                        (mine ? "text-white/70" : "text-faint")
                      }
                    >
                      {mine ? "Você" : "Escritório"} · {format(at, "HH:mm")}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        <form onSubmit={enviar} className="border-t border-line bg-surface p-3 sm:p-4">
          {erro && <p className="mb-2 text-xs font-medium text-danger">{erro}</p>}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar(e as unknown as FormEvent);
                }
              }}
              rows={1}
              placeholder="Escreva sua mensagem…"
              className="max-h-32 min-h-[44px] flex-1 resize-y rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint transition-colors focus:border-brand focus:bg-surface focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || !text.trim()}
              className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-white transition-colors hover:bg-brand-strong disabled:opacity-40"
              title="Enviar"
            >
              {sending ? (
                <Loader2 className="size-[18px] animate-spin" />
              ) : (
                <Send className="size-[18px]" strokeWidth={1.9} />
              )}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-faint">
            Enter envia · Shift+Enter quebra linha
          </p>
        </form>
      </section>
    </div>
  );
}
