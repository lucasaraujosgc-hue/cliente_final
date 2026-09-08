import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { History, RefreshCw, AlertCircle } from "lucide-react";
import { apiFetch } from "../../lib/apiClient";
import { Skeleton } from "../../components/Skeleton";

interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string | null;
  metadata: unknown;
  createdAt: string;
}

const ACTION_TONE: Record<string, string> = {
  "client.create": "bg-emerald-100 text-emerald-700",
  "client.update": "bg-blue-100 text-blue-700",
  "client.delete": "bg-rose-100 text-rose-700",
  "client.reset_password": "bg-amber-100 text-amber-700",
  "token.generate": "bg-indigo-100 text-indigo-700",
  "token.revoke": "bg-slate-200 text-slate-700",
  "files.bulk_delete": "bg-rose-100 text-rose-700",
};

export function Audit() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await apiFetch("/api/accountant/audit?limit=200", {}, "accountant");
      if (!res.ok) throw new Error("Erro ao carregar o histórico");
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (e: any) {
      setError(e.message);
      setEntries([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <History className="w-6 h-6 text-slate-400" /> Histórico de Ações
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Registro das operações sensíveis realizadas no painel do contador.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors shadow-sm"
        >
          <RefreshCw className="w-4 h-4" /> Atualizar
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        {entries === null && (
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {entries?.length === 0 && !error && (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            Nenhuma ação registrada ainda.
          </div>
        )}

        {entries && entries.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/50">
            {entries.map((e) => (
              <li key={e.id} className="px-6 py-4 flex items-start gap-4">
                <span
                  className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                    ACTION_TONE[e.action] || "bg-slate-100 text-slate-600"
                  }`}
                >
                  {e.action}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-slate-800 dark:text-slate-200">
                    {e.summary || `${e.action} ${e.targetId ?? ""}`}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {format(parseISO(e.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    {" · "}
                    <span className="font-mono">{e.actor}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
