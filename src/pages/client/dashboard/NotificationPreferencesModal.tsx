import { X } from "lucide-react";

export interface NotificationPrefsForm {
  receives_all: boolean;
  recurrent: boolean;
  before_due: boolean;
  on_due: boolean;
  on_new_file: boolean;
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

export function NotificationPreferencesModal({
  show,
  form,
  onChange,
  onClose,
  onSave,
}: NotificationPreferencesModalProps) {
  if (!show) return null;

  const check = "size-4 shrink-0 rounded border-line text-brand focus:ring-brand/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-faint transition-colors hover:text-muted"
          aria-label="Fechar"
        >
          <X className="size-5" />
        </button>
        <h3 className="font-serif text-xl font-semibold text-ink">Notificações</h3>
        <p className="mt-1.5 text-sm text-muted">Escolha o que quer receber por push.</p>

        <label className="mt-5 flex items-start gap-3 rounded-lg border border-line bg-sunken px-3.5 py-3 select-none">
          <input
            type="checkbox"
            checked={form.receives_all}
            onChange={(e) => onChange({ ...form, receives_all: e.target.checked })}
            className={`mt-0.5 ${check}`}
          />
          <span>
            <span className="block text-sm font-semibold text-ink">Receber notificações</span>
            <span className="mt-0.5 block text-xs text-muted">Avisos do escritório neste dispositivo.</span>
          </span>
        </label>

        {form.receives_all && (
          <div className="mt-3 space-y-1 border-l border-line pl-4">
            {SUB.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-3 py-1.5 text-sm text-muted select-none">
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
    </div>
  );
}
