import { useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ShieldCheck,
  RefreshCw,
  Search,
  Bell,
  FileWarning,
  ChevronRight,
  X,
  Loader2,
  Gauge,
  CheckCheck,
} from "lucide-react";
import {
  getPainelFiscal,
  rodarVerificacao,
  marcarNotificacoesLidas,
  PROCESSOS,
  ROTULO,
  SITUACAO_ROTULO,
  type PainelFiscal,
  type Processo,
  type Situacao,
} from "../../lib/fiscal";
import { formatCnpj } from "../../lib/cnpj";
import { ClienteFiscalDrawer } from "./fiscal/ClienteFiscalDrawer";

// Painel de pendências fiscais. Os dados vêm do banco (montados pelo monitor
// em services/fiscal); abrir esta tela não gasta consulta no Integra Contador.

export const COR: Record<Situacao, { hex: string; dot: string; chip: string }> = {
  em_dia: { hex: "#10b981", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  pendente: { hex: "#f59e0b", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
  atencao: { hex: "#ef4444", dot: "bg-red-500", chip: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
  processando: { hex: "#38bdf8", dot: "bg-sky-400", chip: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300" },
};
const ORDEM: Situacao[] = ["em_dia", "pendente", "atencao", "processando"];
const LEGENDA: Record<Situacao, string> = {
  em_dia: "Todos os processos em dia",
  pendente: "Possui 1 ou + pendências",
  atencao: "Possui 1 ou + em atenção",
  processando: "Aguardando verificação",
};

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";

export function AccountantFiscal() {
  const [data, setData] = useState<PainelFiscal | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [buscaNotif, setBuscaNotif] = useState("");
  const [filtro, setFiltro] = useState<{ processo?: Processo; situacao?: Situacao } | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);

  const load = () =>
    getPainelFiscal()
      .then((d) => {
        setData(d);
        setErro("");
        setRodando(d.rotinaEmAndamento);
      })
      .catch((e) => setErro(e.message));

  useEffect(() => {
    load();
  }, []);

  // Enquanto a verificação roda no servidor, atualiza a cada 5 s.
  useEffect(() => {
    if (!rodando) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [rodando]);

  const verificarAgora = async () => {
    if (!window.confirm("Verificar todos os clientes agora?\n\nUsa 4 consultas do Integra Contador para todos os clientes (Caixa Postal e DCTFWeb), mais consultas pontuais só de quem tiver prazo vencido sem guia.")) return;
    try {
      await rodarVerificacao();
      setRodando(true);
    } catch (e: any) {
      setErro(e.message);
    }
  };

  const clientes = useMemo(() => {
    if (!data) return [];
    const q = busca.trim().toLowerCase();
    const qd = q.replace(/\D/g, "");
    return data.clientes.filter((c) => {
      if (!c.monitorado) return false;
      if (q && !c.nome.toLowerCase().includes(q) && !(qd && c.cnpj.replace(/\D/g, "").includes(qd))) return false;
      if (filtro?.processo) {
        const s = c.processos[filtro.processo];
        if (!s || (filtro.situacao && s.status !== filtro.situacao)) return false;
      } else if (filtro?.situacao && c.geral !== filtro.situacao) return false;
      return true;
    });
  }, [data, busca, filtro]);

  const notifs = useMemo(() => {
    const q = buscaNotif.trim().toLowerCase();
    return (data?.notificacoes ?? []).filter((n) => !q || `${n.titulo} ${n.descricao} ${n.cliente} ${n.processo}`.toLowerCase().includes(q));
  }, [data, buscaNotif]);

  if (erro && !data) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{erro}</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando painel…
      </div>
    );
  }

  const pie = ORDEM.map((s) => ({ name: s, value: data.resumo[s] })).filter((x) => x.value > 0);
  const usoPct = Math.min(100, Math.round((data.uso.mes / Math.max(1, data.uso.limite)) * 100));
  const naoLidas = data.notificacoes.filter((n) => !n.lida).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            <ShieldCheck className="h-6 w-6 text-emerald-500" /> Pendências fiscais
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Situação fiscal dos clientes por processo. Filtre clicando nos indicadores.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300" title="Consultas do painel ao Integra Contador neste mês">
            <Gauge className="h-4 w-4 text-slate-400" />
            <span className="tabular-nums">{data.uso.mes}/{data.uso.limite}</span> consultas no mês
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <span className={`block h-full ${usoPct > 85 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${usoPct}%` }} />
            </span>
          </div>
          <button
            onClick={verificarAgora}
            disabled={rodando}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60 dark:bg-indigo-600 dark:hover:bg-indigo-500"
          >
            {rodando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {rodando ? "Verificando…" : "Verificar agora"}
          </button>
        </div>
      </header>

      {data.ultimaRotina && (
        <p className="-mt-3 text-xs text-slate-500 dark:text-slate-400">
          Última verificação: {format(parseISO(data.ultimaRotina.executadoEm), "dd/MM/yyyy HH:mm", { locale: ptBR })}
          {data.ultimaRotina.resultado?.erro ? ` — erro: ${data.ultimaRotina.resultado.erro}` : ""} · avaliação diária às 7h; Caixa Postal 2×/semana e DCTFWeb 1×/mês no Integra Contador.
        </p>
      )}
      {erro && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{erro}</div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        {/* ---- visão geral + por processo ---- */}
        <section className={CARD}>
          <h2 className="font-bold text-slate-900 dark:text-white">Pendências fiscais</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Acompanhe a situação fiscal dos seus clientes e filtre pelos indicadores.</p>
          <div className="mt-5 grid gap-6 md:grid-cols-[240px_1fr] md:divide-x md:divide-slate-100 dark:md:divide-slate-800">
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Visão geral dos clientes</p>
              <div className="relative mx-auto h-44 w-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pie.length ? pie : [{ name: "vazio", value: 1 }]} dataKey="value" innerRadius={52} outerRadius={80} stroke="none" isAnimationActive={false}>
                      {(pie.length ? pie : [{ name: "vazio" }]).map((p) => (
                        <Cell key={p.name} fill={COR[p.name as Situacao]?.hex ?? "#e2e8f0"} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{data.resumo.total}</span>
                  <span className="text-xs text-slate-500">clientes</span>
                </div>
              </div>
              <ul className="mt-3 space-y-1">
                {ORDEM.map((s) => (
                  <li key={s}>
                    <button
                      onClick={() => setFiltro(filtro?.situacao === s && !filtro.processo ? null : { situacao: s })}
                      className={`flex w-full items-center justify-between rounded-lg border-l-4 px-2 py-1.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 ${filtro?.situacao === s && !filtro.processo ? "bg-slate-50 dark:bg-slate-800" : ""}`}
                      style={{ borderLeftColor: COR[s].hex }}
                    >
                      <span>
                        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{SITUACAO_ROTULO[s]}</span>
                        <span className="block text-[11px] text-slate-500">{LEGENDA[s]}</span>
                      </span>
                      <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{data.resumo[s]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="md:pl-6">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Por processo</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                {ORDEM.map((s) => (
                  <span key={s} className="flex items-center gap-1">
                    <span className={`h-2 w-2 rounded-sm ${COR[s].dot}`} />
                    {SITUACAO_ROTULO[s]} ({data.porProcesso.reduce((acc, p) => acc + p[s], 0)})
                  </span>
                ))}
              </div>
              <div className="mt-4 space-y-3">
                {data.porProcesso.map((p) => {
                  const total = ORDEM.reduce((acc, s) => acc + p[s], 0);
                  return (
                    <div key={p.processo} className="grid grid-cols-[120px_1fr] items-center gap-3">
                      <button
                        onClick={() => setFiltro(filtro?.processo === p.processo && !filtro.situacao ? null : { processo: p.processo })}
                        className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${filtro?.processo === p.processo ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}
                      >
                        {p.rotulo} <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      <div className="flex h-6 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                        {total === 0 ? (
                          <span className="px-2 text-[11px] leading-6 text-slate-400">sem clientes</span>
                        ) : (
                          ORDEM.map((s) =>
                            p[s] ? (
                              <button
                                key={s}
                                title={`${SITUACAO_ROTULO[s]}: ${p[s]}`}
                                onClick={() => setFiltro({ processo: p.processo, situacao: s })}
                                className={`${COR[s].dot} h-full transition-opacity hover:opacity-80`}
                                style={{ width: `${(p[s] / total) * 100}%` }}
                              />
                            ) : null,
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ---- notificações ---- */}
        <section className={`${CARD} flex max-h-[560px] flex-col`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                <Bell className="h-4 w-4" /> Notificações
                {naoLidas > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{naoLidas}</span>}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Do seu monitoramento fiscal.</p>
            </div>
            {naoLidas > 0 && (
              <button onClick={() => marcarNotificacoesLidas().then(load)} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                <CheckCheck className="h-3.5 w-3.5" /> Marcar lidas
              </button>
            )}
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={buscaNotif} onChange={(e) => setBuscaNotif(e.target.value)} placeholder="Busque por título, processo ou cliente" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          </div>
          <ul className="mt-3 flex-1 space-y-2 overflow-y-auto">
            {notifs.length === 0 && <li className="py-8 text-center text-sm text-slate-400">Nenhuma notificação.</li>}
            {notifs.map((n) => (
              <li key={n.id}>
                <button onClick={() => setAberto(n.clientId)} className={`w-full rounded-xl border p-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 ${n.lida ? "border-slate-100 dark:border-slate-800" : "border-indigo-200 bg-indigo-50/40 dark:border-indigo-900 dark:bg-indigo-950/20"}`}>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{n.titulo}</p>
                  <p className="text-xs font-medium text-slate-500">{n.cliente}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{n.descricao}</p>
                  <p className="mt-1 text-right text-[10px] text-slate-400">{format(parseISO(n.createdAt), "dd/MM/yyyy HH:mm")}</p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ---- ausência de declarações ---- */}
      <section className={CARD}>
        <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <FileWarning className="h-4 w-4" /> Ausência de declarações
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Competência anterior, prazo vencido e nada transmitido.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(["PGDASD", "DCTFWEB"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setFiltro({ processo: p, situacao: "atencao" })}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 text-left hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              <span className="font-semibold text-slate-800 dark:text-slate-100">{ROTULO[p]}</span>
              <span className="flex gap-4 text-sm font-bold tabular-nums">
                <span className="text-red-600 dark:text-red-400" title="Sem declaração">{data.ausencias[p].ausentes} ausentes</span>
                <span className="text-emerald-600 dark:text-emerald-400">{data.ausencias[p].entregues} ok</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ---- clientes ---- */}
      <section className={CARD}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white">Clientes</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{clientes.length} de {data.resumo.total} monitorados</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {filtro && (
              <button onClick={() => setFiltro(null)} className="flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                {filtro.processo ? ROTULO[filtro.processo] : "Geral"}
                {filtro.situacao ? ` · ${SITUACAO_ROTULO[filtro.situacao]}` : ""}
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou CNPJ" className="w-56 rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-800">
                <th className="py-2 pr-3 font-semibold">Cliente</th>
                <th className="px-2 font-semibold">Geral</th>
                {PROCESSOS.map((p) => (
                  <th key={p} className="px-2 text-center font-semibold">{ROTULO[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id} onClick={() => setAberto(c.id)} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/50">
                  <td className="py-2.5 pr-3">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{c.nome}</p>
                    <p className="text-xs text-slate-500">{formatCnpj(c.cnpj)}</p>
                  </td>
                  <td className="px-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${COR[c.geral].chip}`}>{SITUACAO_ROTULO[c.geral]}</span>
                  </td>
                  {PROCESSOS.map((p) => {
                    const s = c.processos[p];
                    return (
                      <td key={p} className="px-2 text-center">
                        {s ? (
                          <span title={s.resumo} className={`inline-block h-3 w-3 rounded-full ${COR[s.status].dot}`} />
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {clientes.length === 0 && (
                <tr>
                  <td colSpan={2 + PROCESSOS.length} className="py-10 text-center text-sm text-slate-400">
                    {data.resumo.total === 0 ? "Nenhum cliente avaliado ainda. Clique em “Verificar agora”." : "Nenhum cliente neste filtro."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {aberto && <ClienteFiscalDrawer clientId={aberto} onClose={() => setAberto(null)} onChange={load} />}
    </div>
  );
}
