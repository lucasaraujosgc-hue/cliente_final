import { useEffect, useState } from "react";
import { Wand2, Loader2, AlertTriangle } from "lucide-react";
import { adminEstadoLoteAtividades, adminIniciarLoteAtividades, type LoteAtividadesEstado } from "../../../lib/nfse";

// "Sugerir atividades de todos": para cada cliente, cria as atividades de NFS-e
// pelas notas anteriores (ou, sem notas, pelo CNAE) — desligadas e marcadas
// como sugeridas até o contador conferir (services/nfse/sugestao.ts). Roda no
// servidor; aqui só inicia e acompanha.

export function LoteAtividades({ onFim }: { onFim?: () => void }) {
  const [estado, setEstado] = useState<LoteAtividadesEstado | null>(null);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    adminEstadoLoteAtividades().then((e) => {
      setEstado(e);
      if (e) setAberto(true);
    });
  }, []);

  // Acompanha enquanto roda.
  useEffect(() => {
    if (!estado?.emAndamento) return;
    const t = setInterval(async () => {
      const e = await adminEstadoLoteAtividades().catch(() => null);
      if (!e) return;
      setEstado(e);
      if (!e.emAndamento) onFim?.();
    }, 3000);
    return () => clearInterval(t);
  }, [estado?.emAndamento]);

  const iniciar = async () => {
    if (
      !window.confirm(
        "Sugerir as atividades de NFS-e de todos os clientes?\n\n" +
          "• Pelas notas que cada um já emitiu (código, código municipal, NBS e a descrição mais usada); sem notas, pelo CNAE na Receita.\n" +
          "• ISS 2,01% e 6% de tributos aproximados do Simples.\n" +
          "• Tudo é criado DESLIGADO e marcado “sugerida — conferir”: nada é emitido até você abrir, conferir e ativar.\n" +
          "• Atividades que já existem não são alteradas; MEI fica de fora.\n\n" +
          "Leva alguns minutos.",
      )
    )
      return;
    setErro("");
    try {
      setEstado(await adminIniciarLoteAtividades());
      setAberto(true);
    } catch (e: any) {
      setErro(e.message);
    }
  };

  const criadas = estado?.resultados.reduce((a, r) => a + r.criadas.length, 0) ?? 0;
  const comErro = estado?.resultados.filter((r) => r.erro).length ?? 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-slate-800 dark:text-white">Sugerir as atividades de todos os clientes</p>
          <p className="text-xs text-slate-500">
            {estado?.emAndamento
              ? `Processando ${estado.feitos} de ${estado.total}…`
              : estado
                ? `Última execução: ${new Date(estado.fim || estado.inicio).toLocaleString("pt-BR")} · ${criadas} atividade(s) sugerida(s)${comErro ? ` · ${comErro} com erro` : ""}`
                : "Pelas notas anteriores ou pelo CNAE. ISS 2,01% e Simples 6%. Criadas desligadas para você conferir."}
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
            {estado?.emAndamento ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {estado?.emAndamento ? "Sugerindo…" : "Sugerir atividades"}
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
                <th className="px-2">Sugeridas</th>
                <th className="px-2">Observação</th>
              </tr>
            </thead>
            <tbody>
              {estado.resultados.map((r) => (
                <tr key={r.clientId} className="border-b border-slate-50 align-top dark:border-slate-800/60">
                  <td className="py-2 pr-3 font-semibold text-slate-800 dark:text-slate-100">{r.nome}</td>
                  <td className="px-2 py-2 text-slate-600 dark:text-slate-300">
                    {r.criadas.length === 0
                      ? "—"
                      : r.criadas.map((c) => (
                          <span key={c.cTribNac} className="block">
                            <span className="font-mono">{c.cTribNac}</span> {c.nome.length > 60 ? `${c.nome.slice(0, 60)}…` : c.nome}{" "}
                            <span className="text-slate-400">({c.origem === "notas" ? "notas" : "CNAE"}{c.aliqMunicipal != null ? ` · prefeitura ${c.aliqMunicipal.toLocaleString("pt-BR")}%` : ""})</span>
                            {c.conferir && <span className="block text-amber-600 dark:text-amber-400">{c.conferir}</span>}
                          </span>
                        ))}
                  </td>
                  <td className="px-2 py-2">
                    {r.erro ? (
                      <span className="flex items-start gap-1 text-red-600 dark:text-red-400">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {r.erro}
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        {[r.motivo, r.jaExistiam ? `${r.jaExistiam} já cadastrada(s)` : null].filter(Boolean).join(" · ") || "conferir e ativar"}
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
