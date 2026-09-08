import { useState, useEffect } from "react";
import { Trash2, Smartphone, AlertCircle, RefreshCw } from "lucide-react";
import { apiFetch } from "../../lib/apiClient";
import { formatCnpj } from "../../lib/cnpj";

export function Devices() {
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscriptions = async () => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/accountant/subscriptions", {}, "accountant");
      if (!res.ok) throw new Error("Erro ao carregar dispositivos");
      const data = await res.json();
      setSubscriptions(data.subscriptions || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Deseja realmente remover esta assinatura? O cliente receberá a solicitação para ativar novamente ao acessar.")) return;
    try {
      const res = await apiFetch(`/api/accountant/subscriptions/${id}`, {
        method: "DELETE",
      }, "accountant");
      if (!res.ok) throw new Error("Erro ao excluir dispositivo");
      fetchSubscriptions();
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Dispositivos e Notificações
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Gerencie os dispositivos dos clientes que ativaram o recebimento de notificações push.
          </p>
        </div>
        <button
          onClick={fetchSubscriptions}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors shadow-sm"
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
        {loading ? (
          <div className="p-8 text-center text-slate-500">Carregando dispositivos...</div>
        ) : subscriptions.length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
              <Smartphone className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Nenhum dispositivo</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
              Ainda não há clientes com notificações ativadas.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-6 py-4">Cliente / CNPJ</th>
                  <th className="px-6 py-4">Dispositivo</th>
                  <th className="px-6 py-4">FCM / Web Push</th>
                  <th className="px-6 py-4">Data de Ativação</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {sub.client?.name || "Desconhecido"}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        {sub.client?.cnpj ? formatCnpj(sub.client.cnpj) : "S/ CNPJ"}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-slate-400" />
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {sub.deviceName || "Dispositivo Desconhecido"}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        {sub.fcmToken && (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 w-max">
                            App Mobile (FCM)
                          </span>
                        )}
                        {sub.subscriptionObject && (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 w-max">
                            Web (Navegador)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {new Date(sub.createdAt).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDelete(sub.id)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                        title="Excluir Dispositivo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
