import { useEffect, useState } from "react";
import { X, BellOff } from "lucide-react";
import { format, parseISO, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { apiFetch } from "../../../lib/apiClient";

export interface NotificationPrefsForm {
  receives_all: boolean;
  recurrent: boolean;
  before_due: boolean;
  on_due: boolean;
  on_new_file: boolean;
}

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

interface NotificationPreferencesModalProps {
  show: boolean;
  form: NotificationPrefsForm;
  onChange: (form: NotificationPrefsForm) => void;
  onClose: () => void;
  onSave: () => void;
}

const SUB: { key: keyof NotificationPrefsForm; label: string }[] = [
  { key: "recurrent", label: "Lembretes mensais" },
  { key: "before_due", label: "Dias antes do vencimento" },
  { key: "on_due", label: "No dia do vencimento" },
  { key: "on_new_file", label: "Quando uma nova guia for gerada" },
];

// Duas abas: o histórico do que já foi avisado (antes o push era
// fire-and-forget — dispensou, sumiu) e as preferências de envio.
export function NotificationPreferencesModal({
  show,
  form,
  onChange,
  onClose,
  onSave,
}: NotificationPreferencesModalProps) {
  const [tab, setTab] = useState<"avisos" | "prefs">("avisos");
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  useEffect(() => {
    if (!show) return;
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch("/api/client/notifications");
        const data = await res.json();
        if (!alive) return;
        setItems(data.notifications || []);
        if ((data.unread ?? 0) > 0) {
          await apiFetch("/api/client/notifications/read", { method: "POST" });
          window.dispatchEvent(new CustomEvent("notifications-read"));
        }
      } catch {
        if (alive) setItems([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [show]);

  if (!show) return null;

  const check = "size-4 shrink-0 rounded border-line text-brand focus:ring-brand/40";
  const tabCls = (active: boolean) =>
    "flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors " +
    (active ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[85dvh] w-full max-w-sm flex-col rounded-2xl border border-line bg-surface p-6 shadow-lg">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-faint transition-colors hover:text-muted"
          aria-label="Fechar"
        >
          <X className="size-5" />
        </button>
        <h3 className="font-serif text-xl font-semibold text-ink">Notificações</h3>

        <div className="mt-4 flex gap-1 rounded-xl border border-line bg-sunken p-1">
          <button onClick={() => setTab("avisos")} className={tabCls(tab === "avisos")}>
            Avisos
          </button>
          <button onClick={() => setTab("prefs")} className={tabCls(tab === "prefs")}>
            Preferências
          </button>
        </div>

        {tab === "avisos" ? (
          <div className="-mr-2 mt-4 min-h-[180px] flex-1 space-y-3 overflow-y-auto pr-2">
            {items === null && <p className="py-8 text-center text-sm text-muted">Carregando…</p>}

            {items?.length === 0 && (
              <div className="py-10 text-center">
                <BellOff className="mx-auto size-7 text-faint" strokeWidth={1.6} />
                <p className="mt-3 text-sm font-semibold text-ink">Nenhum aviso ainda</p>
                <p className="mx-auto mt-1 max-w-[16rem] text-xs leading-relaxed text-muted">
                  Lembretes de vencimento e avisos de guia nova aparecem aqui.
                </p>
              </div>
            )}

            {items?.map((n, i) => {
              const at = parseISO(n.createdAt);
              const prev = i > 0 ? parseISO(items[i - 1].createdAt) : null;
              const newDay = !prev || !isSameDay(prev, at);
              return (
                <div key={n.id}>
                  {newDay && (
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                      {format(at, "d 'de' MMMM", { locale: ptBR })}
                    </p>
                  )}
                  <div
                    className={
                      "rounded-xl border px-3.5 py-3 " +
                      (n.read ? "border-line bg-surface" : "border-brand/30 bg-brand-wash")
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-snug text-ink">{n.title}</p>
                      <span className="shrink-0 text-[10px] text-faint tabular-nums">
                        {format(at, "HH:mm")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{n.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 flex-1 overflow-y-auto">
            <p className="text-sm text-muted">Escolha o que quer receber por push.</p>

            <label className="mt-4 flex select-none items-start gap-3 rounded-lg border border-line bg-sunken px-3.5 py-3">
              <input
                type="checkbox"
                checked={form.receives_all}
                onChange={(e) => onChange({ ...form, receives_all: e.target.checked })}
                className={`mt-0.5 ${check}`}
              />
              <span>
                <span className="block text-sm font-semibold text-ink">Receber notificações</span>
                <span className="mt-0.5 block text-xs text-muted">
                  Avisos do escritório neste dispositivo.
                </span>
              </span>
            </label>

            {form.receives_all && (
              <div className="mt-3 space-y-1 border-l border-line pl-4">
                {SUB.map(({ key, label }) => (
                  <label
                    key={key}
                    className="flex select-none items-center gap-3 py-1.5 text-sm text-muted"
                  >
                    <input
                      type="checkbox"
                      checked={form[key]}
                      onChange={(e) => onChange({ ...form, [key]: e.target.checked })}
                      className={check}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}

            <button
              onClick={onSave}
              className="mt-6 w-full rounded-lg bg-brand py-2.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong"
            >
              Salvar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
