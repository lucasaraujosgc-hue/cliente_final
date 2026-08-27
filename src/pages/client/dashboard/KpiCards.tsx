import { TrendingUp, Activity, Clock, AlertCircle, CheckCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface KpiCardsProps {
  selectedCompetence: string;
  monthsTotalBilling: number;
  pendingDocsCount: number;
  totalPendingValue: number;
  overdueDocsCount: number;
  totalOverdueValue: number;
}

export function KpiCards({
  selectedCompetence,
  monthsTotalBilling,
  pendingDocsCount,
  totalPendingValue,
  overdueDocsCount,
  totalOverdueValue,
}: KpiCardsProps) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Stat 1: Faturamento do Mês */}
      <div className="bg-white dark:bg-slate-800/90 border border-slate-100 dark:border-slate-800 p-5 rounded-3xl shadow-sm hover:shadow-md transition-shadow flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Faturamento Declarado ({selectedCompetence})</p>
          <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
            {monthsTotalBilling.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </h3>
          <p className="text-[10px] text-slate-500 flex items-center">
            <TrendingUp className="w-3 h-3 text-emerald-500 mr-1" />
            Preenchido pela contabilidade & manual
          </p>
        </div>
        <div className="p-3 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 rounded-2xl">
          <Activity className="w-5 h-5" />
        </div>
      </div>

      {/* Stat 2: Documentos e Guias Pendentes */}
      <div className="bg-white dark:bg-slate-800/90 border border-slate-100 dark:border-slate-800 p-5 rounded-3xl shadow-sm hover:shadow-md transition-shadow flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Guias de Impostos / Salários ({selectedCompetence})</p>
          <h3 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            {pendingDocsCount} {pendingDocsCount === 1 ? 'pendência' : 'pendências'}
          </h3>
          {pendingDocsCount > 0 && (
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
              Total: {totalPendingValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          )}
          <p className="text-[10px] text-slate-500">
            {pendingDocsCount === 0 ? "🎉 Tudo pago e em dia!" : "⚠️ Requer atenção no vencimento"}
          </p>
        </div>
        <div className={`p-3 rounded-2xl ${pendingDocsCount > 0 ? "bg-amber-500/10 text-amber-500 dark:text-amber-400" : "bg-slate-100 dark:bg-slate-700 text-slate-400"}`}>
          <Clock className="w-5 h-5" />
        </div>
      </div>

      {/* Stat 3: Guias em Atraso Geral */}
      <div
        className={`bg-white dark:bg-slate-800/90 border border-slate-100 dark:border-slate-800 p-5 rounded-3xl shadow-sm transition-shadow flex items-center justify-between ${overdueDocsCount > 0 ? 'cursor-pointer hover:shadow-md ring-2 ring-rose-500/20' : 'hover:shadow-md cursor-pointer'}`}
        onClick={() => navigate('/overdue')}
      >
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">GUIAS EM ATRASO GERAL</p>
          <h3 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
            {overdueDocsCount > 0 ? (
              <span className="text-rose-500 dark:text-rose-400 flex items-center gap-1 cursor-pointer underline decoration-dotted">
                {overdueDocsCount} atrasadas
              </span>
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                Nenhuma 🟢
              </span>
            )}
          </h3>
          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
            Total: {totalOverdueValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
        </div>
        <div className={`p-3 rounded-2xl ${overdueDocsCount > 0 ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-500"}`}>
          {overdueDocsCount > 0 ? <AlertCircle className="w-5 h-5 animate-pulse" /> : <CheckCircle className="w-5 h-5" />}
        </div>
      </div>
    </div>
  );
}
