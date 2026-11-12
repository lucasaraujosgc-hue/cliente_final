import { useEffect, useState } from "react";
import { CloudDownload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { adminEstadoLoteProcuracao, adminIniciarLoteProcuracao, type LoteEstado } from "../../../lib/nfse";

// "Configurar e buscar notas de todos": liga a NFS-e por procuração (sem ligar a
// emissão) e busca as notas no portal nacional; o faturamento do cliente sai
// das notas. Roda no servidor; aqui só inicia e acompanha.

const ACAO: Record<string, string> = {
  configurado: "configurado por procuração",
  procuracao_ligada: "procuração ligada",
  mantido: "configuração mantida",
};

export function LoteProcuracao({ onFim }: { onFim?: () => void }) {
  const [estado, setEstado] = useState<LoteEstado | null>(null);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    adminEstadoLoteProcuracao().then((e) => {
      setEstado(e);
      if (e) setAberto(true);
    });
  }, []);

  // Acompanha enquanto roda.
  useEffect(() => {
    if (!estado?.emAndamento) return;
    const t = setInterval(async () => {
      const e = await adminEstadoLoteProcuracao().catch(() => null);
      if (!e) return;
      setEstado(e);
      if (!e.emAndamento) onFim?.();
    }, 3000);
    return () => clearInterval(t);
  }, [estado?.emAndamento]);

  const iniciar = async () => {
    if (
      !window.confirm(
        "Configurar e buscar as notas de todos os clientes?\n\n" +
          "• Quem não tem certificado A1 cadastrado passa a usar o certificado do escritório (procuração), em produção — a emissão continua desligada até você configurar as atividades.\n" +
          "• Busca as notas de cada um no portal nacional (sem custo no Integra Contador).\n" +
          "• Preenche o faturamento (serviços prestados e tomados) pelas notas, sem mexer no que foi editado à mão.\n\n" +
          "Leva alguns minutos.",
      )
    )
      return;
    setErro("");
    try {
      setEstado(await adminIniciarLoteProcuracao());
      setAberto(true);
    } catch (e: any) {
      setErro(e.message);
    }
  };

  const comErro = estado?.resultados.filter((r) => r.erro).length ?? 0;
  const notas = estado?.resultados.reduce((a, r) => a + r.notasNovas, 0) ?? 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-slate-800 dark:text-white">Buscar as notas de todos os clientes</p>
          <p className="text-xs text-slate-500">
            {estado?.emAndamento
              ? `Processando ${estado.feitos} de ${estado.total}…`
              : estado
                ? `Última execução: ${new Date(estado.fim || estado.inicio).toLocaleString("pt-BR")} · ${notas} nota(s) nova(s)${comErro ? ` · ${comErro} com erro` : ""}`
                : "Por procuração, com o certificado do escritório. Preenche o faturamento pelas notas."}
          </p>
        </div>
        <div className="flex gap-2">
          {estado && !estado.emAndamento && (
            <button onClick={() => setAberto(!aberto)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              {aberto ? "Ocultar resultado" : "Ver resultado"}
            </button>
          )}
          <button
            onClick={iniciar}
            disabled={!!estado?.emAndamento}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {estado?.emAndamento ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
            {estado?.emAndamento ? "Buscando…" : "Configurar e buscar"}
          </button>
        </div>
      </div>
      {erro && <p className="mt-2 text-xs font-semibold text-red-600">{erro}</p>}
      {estado?.emAndamento && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${(estado.feitos / Math.max(1, estado.total)) * 100}%` }} />
        </div>
      )}

      {aberto && estado && estado.resultados.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-800">
                <th className="py-2 pr-3">Cliente</th>
                <th className="px-2">Configuração</th>
                <th className="px-2 text-right">Notas novas</th>
                <th className="px-2 text-right">Meses no faturamento</th>
                <th className="px-2">Observação</th>
              </tr>
            </thead>
            <tbody>
              {estado.resultados.map((r) => (
                <tr key={r.clientId} className="border-b border-slate-50 dark:border-slate-800/60">
                  <td className="py-2 pr-3 font-semibold text-slate-800 dark:text-slate-100">{r.nome}</td>
                  <td className="px-2 text-slate-600 dark:text-slate-300">
                    {r.acao ? ACAO[r.acao] : "—"}
                    {r.acao !== "mantido" && !r.municipio && r.acao ? " · sem município" : ""}
                  </td>
                  <td className="px-2 text-right tabular-nums">
                    {r.notasNovas}
                    {r.tomadasNovas ? <span className="text-slate-400"> ({r.tomadasNovas} recebidas)</span> : null}
                  </td>
                  <td className="px-2 text-right tabular-nums">{r.mesesFaturamento}</td>
                  <td className="px-2">
                    {r.erro ? (
                      <span className="flex items-start gap-1 text-red-600 dark:text-red-400">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {r.erro}
                      </span>
                    ) : r.divergentes ? (
                      <span className="text-amber-600 dark:text-amber-400">{r.divergentes} mês(es) com faturamento informado diferente das notas — mantido</span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> ok
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
