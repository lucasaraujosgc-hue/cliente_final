import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Loader2, Plus, RefreshCw } from "lucide-react";
import {
  adminDownloadEmissaoXml,
  adminGetNotasCliente,
  centavosToBRL,
  nfseApiContador,
  nfseStatusLabel,
  type AdminNotasCliente,
  type NfseEmissao,
} from "../../../lib/nfse";
import { EmitWizard } from "../../client/nfse/EmitWizard";

// Notas de um cliente vistas pelo contador — as emitidas e as recebidas
// (serviço tomado) — e a emissão em nome dele, com o mesmo assistente do app.

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const BTN = "flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";

const MOTIVO: Record<string, string> = {
  sem_config: "configure a emissão acima",
  sem_certificado: "falta o certificado A1",
  inativo: "a emissão está desligada",
  sem_atividade: "cadastre ao menos uma atividade ativa",
};

const TOM: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  danger: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  muted: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

export function NotasCliente({ clientId, versao }: { clientId: string; versao?: string }) {
  const [d, setD] = useState<AdminNotasCliente | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<"emitidas" | "tomadas">("emitidas");
  const [emitindo, setEmitindo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const api = useMemo(() => nfseApiContador(clientId), [clientId]);

  const load = () =>
    adminGetNotasCliente(clientId)
      .then((x) => {
        setD(x);
        setErro("");
      })
      .catch((e) => setErro(e.message));

  useEffect(() => {
    setD(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, versao]);

  const acao = async (chave: string, fn: () => Promise<unknown>) => {
    setOcupado(chave);
    setErro("");
    try {
      await fn();
    } catch (e: any) {
      setErro(e.message || "Falha na operação.");
    } finally {
      setOcupado(null);
    }
  };

  const lista: NfseEmissao[] = (aba === "emitidas" ? d?.emitidas : d?.tomadas) ?? [];

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-white">Notas do cliente</h3>
          <p className="text-xs text-slate-500">
            {d && !d.habilitado
              ? `Para emitir: ${MOTIVO[d.motivo ?? ""] ?? "emissão indisponível"}.`
              : "Emitidas por aqui, pelo app do cliente ou trazidas do portal nacional."}
          </p>
        </div>
        <button
          onClick={() => setEmitindo(true)}
          disabled={!d?.habilitado}
          className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-white dark:text-slate-900"
        >
          <Plus className="h-4 w-4" /> Emitir nota
        </button>
      </div>

      <div className="mt-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {(["emitidas", "tomadas"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAba(t)}
            className={
              "px-3 py-2 text-sm font-bold transition-colors " +
              (aba === t ? "border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200")
            }
          >
            {t === "emitidas" ? "Emitidas" : "Recebidas"} {d ? `(${(t === "emitidas" ? d.emitidas : d.tomadas).length})` : ""}
          </button>
        ))}
      </div>

      {erro && <p className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">{erro}</p>}
      {!d && !erro && (
        <p className="flex items-center gap-2 py-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
      )}
      {d && lista.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-400">
          {aba === "emitidas" ? "Nenhuma nota emitida." : "Nenhuma nota recebida (use “Buscar notas no portal nacional” acima)."}
        </p>
      )}

      <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
        {lista.map((e) => {
          const s = nfseStatusLabel(e.status);
          const outro = aba === "tomadas" ? e.prestadorNome || e.prestadorDoc : e.tomadorNome || e.tomadorDoc || "Sem tomador";
          const temPdf = !!e.chaveAcesso && (e.status === "emitida" || e.status === "cancelada");
          return (
            <li key={e.id} className="py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-white">{outro || "—"}</p>
                  <p className="text-xs text-slate-500">
                    {e.numeroNota ? `Nota ${e.numeroNota}` : "sem número"} · {new Date(e.dataEmissao || e.createdAt).toLocaleDateString("pt-BR")}
                    {e.origem === "distribuicao" && aba === "emitidas" ? " · portal nacional" : ""}
                  </p>
                  {e.status === "rejeitada" && e.rejeicaoMotivo && <p className="mt-0.5 line-clamp-2 text-xs text-red-600 dark:text-red-400">{e.rejeicaoMotivo}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="tabular-nums font-semibold text-slate-700 dark:text-slate-200">{centavosToBRL(e.valorServicos)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${TOM[s.tone]}`}>{s.label}</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {temPdf && (
                  <button onClick={() => acao(`pdf-${e.id}`, () => api.verDanfse(e.id, e.numeroNota))} disabled={!!ocupado} className={BTN}>
                    {ocupado === `pdf-${e.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Ver nota (PDF)
                  </button>
                )}
                {e.chaveAcesso && (
                  <button onClick={() => acao(`xml-${e.id}`, () => adminDownloadEmissaoXml(e.id, "nfse"))} disabled={!!ocupado} className={BTN}>
                    <Download className="h-3.5 w-3.5" /> XML
                  </button>
                )}
                {e.status === "processando" && (
                  <button
                    onClick={() =>
                      acao(`sync-${e.id}`, async () => {
                        const r = await api.sincronizar(e.id);
                        if (!r.ok) throw new Error(r.error || "Falha ao consultar o Sefin.");
                        await load();
                      })
                    }
                    disabled={!!ocupado}
                    className={BTN}
                  >
                    {ocupado === `sync-${e.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Atualizar situação
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {emitindo &&
        d &&
        createPortal(
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 p-3 backdrop-blur-sm sm:p-6">
            <div className="mx-auto max-w-xl rounded-2xl bg-surface p-5 shadow-2xl">
              <EmitWizard
                atividades={d.atividades}
                api={api}
                onClose={() => {
                  setEmitindo(false);
                  setAba("emitidas");
                  load();
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
