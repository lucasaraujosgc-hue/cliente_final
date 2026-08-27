import { Settings, X } from "lucide-react";

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

export function NotificationPreferencesModal({
  show,
  form,
  onChange,
  onClose,
  onSave,
}: NotificationPreferencesModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-500" /> Preferências
          </h3>
          <button
            onClick={onClose}
            className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <input
              type="checkbox"
              checked={form.receives_all}
              onChange={(e) => onChange({ ...form, receives_all: e.target.checked })}
              className="w-4 h-4 text-indigo-600 rounded border-slate-300 dark:border-slate-700 focus:ring-indigo-600 focus:ring-2"
            />
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-none mb-1">Receber Notificações</p>
              <p className="text-[10px] text-slate-500">Ativa o recebimento de avisos do contador.</p>
            </div>
          </label>

          {form.receives_all && (
            <div className="space-y-3 pl-2 border-l-2 border-slate-100 dark:border-slate-800">
              <label className="flex items-center gap-3 p-2 cursor-pointer group">
                <input type="checkbox" checked={form.recurrent} onChange={(e) => onChange({ ...form, recurrent: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 border-slate-300 dark:border-slate-700" />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors">Lembretes Mensais</span>
              </label>
              <label className="flex items-center gap-3 p-2 cursor-pointer group">
                <input type="checkbox" checked={form.before_due} onChange={(e) => onChange({ ...form, before_due: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 border-slate-300 dark:border-slate-700" />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors">Avisar dias antes do vencimento</span>
              </label>
              <label className="flex items-center gap-3 p-2 cursor-pointer group">
                <input type="checkbox" checked={form.on_due} onChange={(e) => onChange({ ...form, on_due: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 border-slate-300 dark:border-slate-700" />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors">Avisar no dia do vencimento</span>
              </label>
              <label className="flex items-center gap-3 p-2 cursor-pointer group">
                <input type="checkbox" checked={form.on_new_file} onChange={(e) => onChange({ ...form, on_new_file: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 border-slate-300 dark:border-slate-700" />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors">Quando gerar nova guia</span>
              </label>
            </div>
          )}
        </div>

        <button
          onClick={onSave}
          className="mt-6 w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition-colors"
        >
          Salvar Preferências
        </button>
      </div>
    </div>
  );
}
