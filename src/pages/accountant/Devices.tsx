import { useState, useEffect } from "react";
import { Trash2, Smartphone, AlertCircle, RefreshCw, Send, CheckCircle2, XCircle, Loader2, ShieldCheck } from "lucide-react";
import { apiFetch } from "../../lib/apiClient";
import { formatCnpj } from "../../lib/cnpj";

// Diagnóstico do push (GET /api/admin/notifications/status).
interface PushStatus {
  firebase: { configurado: boolean; ativo: boolean; projectId: string | null; erro: string | null };
  webPush: { chavesFixas: boolean; chavePublicaInicio: string };
  dispositivos: { app: number; navegador: number };
}
interface ResultadoTeste {
  canal: "app" | "navegador";
  ok: boolean;
  erro: string | null;
  removida: boolean;
}

// Códigos do Firebase / web push em português.
const ERRO_PUSH: Record<string, string> = {
  firebase_nao_configurado: "Firebase não configurado no servidor",
  "messaging/registration-token-not-registered": "aparelho não está mais registrado (app desinstalado ou token vencido)",
  "messaging/invalid-registration-token": "token do aparelho inválido",
  "messaging/mismatched-credential": "a credencial do servidor é de outro projeto Firebase",
  "messaging/invalid-credential": "credencial do Firebase inválida",
  "app/invalid-credential": "credencial do Firebase inválida",
  "messaging/third-party-auth-error": "falha de autenticação com o APNs (iPhone)",
  "HTTP 403": "chave do navegador mudou (VAPID) — o cliente precisa reativar",
};
const textoErro = (e: string | null) => (e ? ERRO_PUSH[e] || e : "");

export function Devices() {
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [testando, setTestando] = useState<string | null>(null);
  const [testes, setTestes] = useState<Record<string, { dryRun: boolean; resultados: ResultadoTeste[] } | { erro: string }>>({});

  const fetchStatus = () =>
    apiFetch("/api/admin/notifications/status", {}, "accountant")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));

  // dryRun: o Firebase confere credenciais e token sem entregar nada.
  const testar = async (id: string, dryRun: boolean) => {
    if (!dryRun && !confirm("Enviar uma notificação de teste para este aparelho? O cliente vai recebê-la.")) return;
    setTestando(`${id}-${dryRun}`);
    try {
      const res = await apiFetch(
        `/api/accountant/subscriptions/${id}/test`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun }) },
        "accountant",
      );
      const data = await res.json().catch(() => ({}));
      setTestes((t) => ({ ...t, [id]: res.ok ? { dryRun, resultados: data.resultados || [] } : { erro: data.error || "Falha no teste." } }));
      if (res.ok && (data.resultados || []).some((r: ResultadoTeste) => r.removida)) fetchSubscriptions();
    } catch (e: any) {
      setTestes((t) => ({ ...t, [id]: { erro: e.message } }));
    } finally {
      setTestando(null);
    }
  };

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
    fetchStatus();
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
          onClick={() => {
            fetchSubscriptions();
            fetchStatus();
          }}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors shadow-sm"
        >
          <RefreshCw className="w-4 h-4" /> Atualizar
        </button>
      </div>

      {status && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-white">
              {status.firebase.ativo ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
              App (Firebase)
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {status.firebase.ativo
                ? `Configurado no servidor — projeto ${status.firebase.projectId}.`
                : `Não está enviando para o app: ${status.firebase.erro || "Firebase não iniciado"}.`}
              {" "}{status.dispositivos.app} aparelho(s) com o app.
            </p>
            {status.firebase.ativo && status.dispositivos.app > 0 && (
              <p className="mt-1 text-xs text-slate-500">Use “Verificar” num aparelho com o app para confirmar as credenciais sem enviar nada.</p>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-white">
              {status.webPush.chavesFixas ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-amber-500" />}
              Navegador (web push)
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {status.webPush.chavesFixas
                ? "Chaves VAPID fixas no servidor."
                : "Chaves VAPID temporárias: mudam a cada atualização do servidor e os navegadores param de receber. Configure VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY."}
              {" "}{status.dispositivos.navegador} navegador(es).
            </p>
          </div>
        </div>
      )}

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
                      <div className="flex items-center justify-end gap-1">
                        {sub.fcmToken && (
                          <button
                            onClick={() => testar(sub.id, true)}
                            disabled={!!testando}
                            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                            title="O Firebase confere credenciais e o aparelho, sem enviar nada"
                          >
                            {testando === `${sub.id}-true` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Verificar
                          </button>
                        )}
                        <button
                          onClick={() => testar(sub.id, false)}
                          disabled={!!testando}
                          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                          title="Envia uma notificação de teste para este aparelho"
                        >
                          {testando === `${sub.id}-false` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Testar
                        </button>
                      <button
                        onClick={() => handleDelete(sub.id)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                        title="Excluir Dispositivo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      </div>
                      {testes[sub.id] && (
                        <div className="mt-1 text-left text-xs">
                          {"erro" in testes[sub.id] ? (
                            <span className="text-red-600 dark:text-red-400">{(testes[sub.id] as { erro: string }).erro}</span>
                          ) : (testes[sub.id] as { resultados: ResultadoTeste[] }).resultados.length === 0 ? (
                            <span className="text-slate-500">Verificação só vale para o app (FCM).</span>
                          ) : (
                            (testes[sub.id] as { dryRun: boolean; resultados: ResultadoTeste[] }).resultados.map((r) => (
                              <span key={r.canal} className={"block " + (r.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                                {r.canal === "app" ? "App" : "Navegador"}:{" "}
                                {r.ok
                                  ? (testes[sub.id] as { dryRun: boolean }).dryRun
                                    ? "Firebase e aparelho OK (nada foi enviado)"
                                    : "enviada"
                                  : textoErro(r.erro)}
                                {r.removida ? " — aparelho removido da lista" : ""}
                              </span>
                            ))
                          )}
                        </div>
                      )}
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
