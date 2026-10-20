import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";
import {
  X,
  Loader2,
  RefreshCw,
  CloudDownload,
  CheckCircle2,
  Undo2,
  Plus,
  Trash2,
  Pencil,
  Save,
  FileText,
  Copy,
  Check,
  Receipt,
  FileSearch,
  Send,
} from "lucide-react";
import {
  getClienteFiscal,
  atualizarClienteFiscal,
  emitirSitfisCliente,
  abrirPdfSitfis,
  gerarEPublicarGuia,
  guiaDoItem,
  salvarPerfilFiscal,
  criarParcelamento,
  editarParcelamento,
  excluirParcelamento,
  buscarParcelamentosSerpro,
  marcarGuiaPaga,
  brl,
  dataDe,
  PROCESSOS,
  ROTULO,
  SITUACAO_ROTULO,
  type DetalheClienteFiscal,
  type GuiaCliente,
  type GuiaPublicada,
  type Parcelamento,
  type Processo,
  type Situacao,
  type SitfisItem,
  type SitfisSecao,
  type TipoGuia,
} from "../../../lib/fiscal";
import { openDocument } from "../../../lib/apiClient";
import { formatCnpj } from "../../../lib/cnpj";
import { COR } from "../Fiscal";

const FIELD = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white";
const LABEL = "text-[11px] font-bold uppercase tracking-wide text-slate-500";
const BTN = "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50";
const BTN_LINHA = `${BTN} border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800`;
const BTN_FORTE = `${BTN} bg-slate-900 text-white hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500`;

const MODALIDADES: [string, string][] = [
  ["INSS", "INSS — parcelamento administrativo (SIPADE)"],
  ["UNIAO", "União — parcelamento na Receita Federal"],
  ["PGFN", "PGFN — dívida ativa da União"],
  ["PARCSN", "Simples Nacional — ordinário"],
  ["PARCSN-ESP", "Simples Nacional — especial"],
  ["PERTSN", "PERT-SN"],
  ["RELPSN", "RELP-SN"],
  ["OUTRO", "Outro"],
];
const rotuloModalidade = (m: string) => MODALIDADES.find(([v]) => v === m)?.[1] ?? m;

const VAZIO: Partial<Parcelamento> = { modalidade: "INSS", numero: "", valorParcela: null, parcelasTotal: null, diaVencimento: null, ultimoPagamento: "", situacao: "" };

const TIPO_GUIA: Record<TipoGuia, string> = { DAS_SIMPLES: "DAS — Simples Nacional", DCTFWEB_INSS: "INSS — DCTFWeb" };
const COMPETENCIA_OK = /^(0[1-9]|1[0-2])\/\d{4}$/;

const fmtData = (v?: string | null) => {
  const d = dataDe(v);
  return d ? format(d, "dd/MM/yyyy") : "—";
};

/** Mesma leitura das telas do cliente: paga, atrasada (dias) ou a vencer. */
function situacaoGuia(g: GuiaCliente) {
  if (g.status === "paid" || g.status === "ok") return { tipo: "paga" as const, rotulo: "Pago", chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" };
  if (g.status === "waiting_accountant") return { tipo: "aguardando" as const, rotulo: "Cliente pediu recálculo", chip: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" };
  const venc = dataDe(g.dueDate);
  const dias = venc ? differenceInCalendarDays(startOfDay(venc), startOfDay(new Date())) : 0;
  if (venc && dias < 0) return { tipo: "atrasada" as const, rotulo: `Atrasada ${-dias} ${dias === -1 ? "dia" : "dias"}`, chip: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300" };
  return { tipo: "aberta" as const, rotulo: dias === 0 ? "Vence hoje" : `Vence em ${dias} ${dias === 1 ? "dia" : "dias"}`, chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" };
}

/** Um débito / inscrição / parcelamento do relatório. */
function ItemSitfis({ item, secao, mei, onGerar }: { item: SitfisItem; secao: SitfisSecao; mei: boolean; onGerar: (t: TipoGuia, c: string) => void }) {
  // O DAS do MEI sai pelo PGMEI, que o gerador de guias não cobre.
  const guia = ((g) => (g && mei && g.tipoGuia === "DAS_SIMPLES" ? null : g))(guiaDoItem(item));
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 dark:text-slate-100">{item.receita || item.texto}</p>
          <p className="mt-0.5 text-slate-500">
            {[
              item.pa ? `PA ${item.pa}` : null,
              item.vencimento ? `venc. ${item.vencimento}` : null,
              item.parcelasEmAtraso != null ? `${item.parcelasEmAtraso} parcela(s) em atraso` : null,
              item.situacao && item.parcelasEmAtraso == null ? item.situacao : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {item.referencia && <p className="mt-0.5 text-[10px] text-slate-400">{secao.tipo === "divida_ativa" ? "Inscrição" : "Ref."} {item.referencia}</p>}
        </div>
        <div className="shrink-0 text-right">
          {item.saldoConsolidado != null && <p className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{brl(item.saldoConsolidado)}</p>}
          {item.parcelasEmAtraso != null && item.situacao && <p className="text-[10px] text-slate-500">{item.situacao}</p>}
        </div>
      </div>
      {guia && (
        <button onClick={() => onGerar(guia.tipoGuia, guia.competencia)} className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
          <Receipt className="h-3.5 w-3.5" /> Gerar guia {guia.tipoGuia === "DAS_SIMPLES" ? "DAS" : "INSS"} {guia.competencia}
        </button>
      )}
    </>
  );
}

interface Props {
  clientId: string;
  onClose: () => void;
  onChange: () => void;
}

export function ClienteFiscalDrawer({ clientId, onClose, onChange }: Props) {
  const [d, setD] = useState<DetalheClienteFiscal | null>(null);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [regime, setRegime] = useState<string>("");
  const [auto, setAuto] = useState(true);
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [form, setForm] = useState<Partial<Parcelamento> | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [gerar, setGerar] = useState<{ tipoGuia: TipoGuia; competencia: string } | null>(null);
  const [publicada, setPublicada] = useState<GuiaPublicada | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const guiasRef = useRef<HTMLElement>(null);

  const load = () =>
    getClienteFiscal(clientId)
      .then((x) => {
        setD(x);
        setRegime(x.perfil.regime ?? "");
        setAuto(!x.perfil.processos);
        setProcessos(x.perfil.processos ?? x.processosEfetivos);
      })
      .catch((e) => setErro(e.message));

  useEffect(() => {
    load();
  }, [clientId]);

  const executar = async (chave: string, fn: () => Promise<unknown>, sucesso?: string) => {
    setOcupado(chave);
    setErro("");
    setMsg("");
    try {
      const r = await fn();
      if (sucesso) setMsg(typeof r === "object" && r && "encontrados" in (r as any) ? `${sucesso} ${(r as any).encontrados} encontrado(s).` : sucesso);
      await load();
      onChange();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  };

  const copiar = (chave: string, texto: string) => {
    navigator.clipboard?.writeText(texto).then(() => {
      setCopiado(chave);
      setTimeout(() => setCopiado(null), 2000);
    });
  };

  const verGuia = (id: string, title?: string) =>
    openDocument(id, "view", { as: "accountant", filename: `${title || "guia"}.pdf` }).catch((e) => setErro(e.message));

  const gerarGuia = (tipoGuia: TipoGuia, competencia: string, documentId?: string) =>
    executar(documentId ? `recalc-${documentId}` : "gerar", async () => {
      const r = await gerarEPublicarGuia(clientId, tipoGuia, competencia, documentId);
      setPublicada(r);
      setGerar(null);
      setMsg(`${r.substituiu ? "Guia atualizada" : "Guia publicada"} no app do cliente. O aviso segue a regra de “arquivo disponível” em Notificações.`);
    });

  const abrirGerar = (tipoGuia: TipoGuia, competencia: string) => {
    setGerar({ tipoGuia, competencia });
    setPublicada(null);
    setTimeout(() => guiasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const salvarParcelamento = () => {
    if (!form) return;
    // "1.234,56" (pt-BR) e "1234.56" → 1234.56. Com vírgula, o ponto é milhar.
    const valor = (v: unknown) => {
      const s = String(v ?? "").trim();
      if (!s) return null;
      const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
      return Number.isFinite(n) ? n : null;
    };
    const body = {
      ...form,
      valorParcela: valor(form.valorParcela),
      parcelasTotal: form.parcelasTotal ? Number(form.parcelasTotal) : null,
      diaVencimento: form.diaVencimento ? Number(form.diaVencimento) : null,
    };
    return executar(
      "parc",
      async () => {
        if (editId) await editarParcelamento(editId, body);
        else await criarParcelamento(clientId, body);
        setForm(null);
        setEditId(null);
      },
      "Parcelamento salvo.",
    );
  };

  const statusDe = (p: Processo) => d?.status.find((s) => s.processo === p);
  const erroRecente = d?.sitfisErro && (!d.sitfis || new Date(d.sitfisErro.em) > new Date(d.sitfis.emitidoEm)) ? d.sitfisErro : null;
  const guias = d?.guias ?? [];
  const ordem = { atrasada: 0, aguardando: 1, aberta: 2, paga: 3 };
  const guiasOrdenadas = [...guias].sort((a, b) => ordem[situacaoGuia(a).tipo] - ordem[situacaoGuia(b).tipo] || (dataDe(a.dueDate)?.getTime() ?? 0) - (dataDe(b.dueDate)?.getTime() ?? 0));
  const atrasadas = guias.filter((g) => situacaoGuia(g).tipo === "atrasada");
  const totalAtrasado = atrasadas.reduce((acc, g) => acc + (g.valor ?? 0), 0);

  // Portal no <body>: dentro do layout do contador a gaveta ficaria presa no
  // contexto de empilhamento do conteúdo, por baixo do cabeçalho.
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white p-4 shadow-2xl dark:bg-slate-900 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{d?.cliente.nome ?? "…"}</h2>
            {d && (
              <p className="text-xs text-slate-500">
                {formatCnpj(d.cliente.cnpj)}
                {d.sitfis?.resultado?.situacaoCadastral ? ` · situação cadastral ${d.sitfis.resultado.situacaoCadastral}` : ""}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {erro && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{erro}</p>}
        {msg && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{msg}</p>}
        {!d && !erro && (
          <p className="mt-6 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
        )}

        {d && (
          <>
            {/* ---- relatório de situação fiscal ---- */}
            <section className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
                    <FileSearch className="h-4 w-4" /> Relatório de situação fiscal
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {d.sitfis
                      ? `Emitido em ${format(parseISO(d.sitfis.emitidoEm), "dd/MM/yyyy 'às' HH:mm")}${d.sitfis.resultado?.semPendencias ? " · sem pendências" : ""}`
                      : "Ainda não emitido — sai automaticamente toda segunda-feira."}
                  </p>
                </div>
                <div className="flex gap-2">
                  {d.sitfis?.temPdf && (
                    <button onClick={() => abrirPdfSitfis(clientId, d.cliente.cnpj).catch((e) => setErro(e.message))} className={BTN_LINHA}>
                      <FileText className="h-3.5 w-3.5" /> Ver PDF
                    </button>
                  )}
                  <button
                    onClick={() =>
                      window.confirm("Emitir o relatório de situação fiscal agora?\n\nUsa 2 consultas do Integra Contador e leva de alguns segundos a 1 minuto.") &&
                      executar("sitfis", () => emitirSitfisCliente(clientId), "Relatório emitido e pendências atualizadas.")
                    }
                    disabled={!!ocupado}
                    className={BTN_FORTE}
                  >
                    {ocupado === "sitfis" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
                    {ocupado === "sitfis" ? "Emitindo…" : "Emitir agora"}
                  </button>
                </div>
              </div>
              {d.sitfis?.aviso && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{d.sitfis.aviso}</p>}
              {erroRecente && (
                <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  Tentativa de {format(parseISO(erroRecente.em), "dd/MM HH:mm")} falhou: {erroRecente.erro}
                </p>
              )}
            </section>

            {/* ---- pendências ---- */}
            <section className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Pendências</h3>
                <button
                  onClick={() => executar("local", () => atualizarClienteFiscal(clientId), "Situação reavaliada.")}
                  disabled={!!ocupado}
                  className={BTN_LINHA}
                  title="Reavalia com o último relatório e as guias do portal — sem consultar o SERPRO"
                >
                  {ocupado === "local" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Reavaliar
                </button>
              </div>
              <ul className="mt-3 space-y-2">
                {PROCESSOS.filter((p) => statusDe(p)).map((p) => {
                  const s = statusDe(p)!;
                  const secoes: SitfisSecao[] = Array.isArray(s.detalhes?.secoes) ? s.detalhes.secoes : [];
                  return (
                    <li key={p} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{ROTULO[p]}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${COR[s.status as Situacao].chip}`}>{SITUACAO_ROTULO[s.status as Situacao]}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{s.resumo}</p>

                      {secoes.map((sec, i) => (
                        <div key={i} className="mt-2">
                          {(secoes.length > 1 || sec.tipo !== "omissao") && (
                            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                              {sec.titulo} · {sec.orgao === "PGFN" ? "Procuradoria" : "Receita"}
                            </p>
                          )}
                          {sec.periodos.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {sec.periodos.map((per) => (
                                <span key={per} className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300">{per}</span>
                              ))}
                            </div>
                          )}
                          {sec.itens.length > 0 && (
                            <ul className="mt-1.5 space-y-1.5">
                              {sec.itens.map((item, j) => (
                                <li key={j} className="rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-800/60">
                                  <ItemSitfis item={item} secao={sec} mei={d.perfil.regime === "mei"} onGerar={abrirGerar} />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}

                      {Array.isArray(s.detalhes?.mensagens) && s.detalhes.mensagens.length > 0 && (
                        <ul className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3 text-xs text-slate-500 dark:border-slate-700">
                          {s.detalhes.mensagens.map((m: any, i: number) => (
                            <li key={i} className={m.relevante ? "font-semibold text-red-600 dark:text-red-400" : ""}>{m.assunto}</li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 text-[10px] text-slate-400">
                        Fonte: {s.fonte === "serpro" ? "Integra Contador" : s.fonte === "portal" ? "guias do portal" : "cadastro manual"} · {format(parseISO(s.verificadoEm), "dd/MM HH:mm")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* ---- guias do cliente (o que ele vê no app) ---- */}
            <section ref={guiasRef} className="mt-6 scroll-mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100">Guias do cliente</h3>
                  <p className="text-xs text-slate-500">
                    Como aparecem no app dele.
                    {atrasadas.length > 0 && ` ${atrasadas.length} em atraso${totalAtrasado ? ` · ${brl(totalAtrasado)}` : ""}.`}
                  </p>
                </div>
                <button onClick={() => { setGerar(gerar ? null : { tipoGuia: "DAS_SIMPLES", competencia: "" }); setPublicada(null); }} className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-700`}>
                  <Receipt className="h-3.5 w-3.5" /> Gerar guia
                </button>
              </div>

              {gerar && (
                <div className="mt-3 grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20 sm:grid-cols-[1fr_140px_auto] sm:items-end">
                  <div>
                    <label className={LABEL}>Guia</label>
                    <select className={FIELD} value={gerar.tipoGuia} onChange={(e) => setGerar({ ...gerar, tipoGuia: e.target.value as TipoGuia })}>
                      {(Object.keys(TIPO_GUIA) as TipoGuia[]).map((t) => <option key={t} value={t}>{TIPO_GUIA[t]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Competência</label>
                    <input
                      className={FIELD}
                      inputMode="numeric"
                      placeholder="MM/AAAA"
                      value={gerar.competencia}
                      onChange={(e) => {
                        const n = e.target.value.replace(/\D/g, "").slice(0, 6);
                        setGerar({ ...gerar, competencia: n.length > 2 ? `${n.slice(0, 2)}/${n.slice(2)}` : n });
                      }}
                    />
                  </div>
                  <button
                    onClick={() =>
                      window.confirm(`Gerar ${TIPO_GUIA[gerar.tipoGuia]} de ${gerar.competencia} no Integra Contador (1 consulta), com multa e juros até hoje?\n\nA guia vai para o app do cliente (substitui a guia em aberto da mesma competência, se houver).`) &&
                      gerarGuia(gerar.tipoGuia, gerar.competencia)
                    }
                    disabled={!!ocupado || !COMPETENCIA_OK.test(gerar.competencia)}
                    className={`${BTN} h-[38px] bg-emerald-600 text-white hover:bg-emerald-700`}
                  >
                    {ocupado === "gerar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {ocupado === "gerar" ? "Gerando…" : "Gerar e publicar"}
                  </button>
                  <p className="text-[11px] text-slate-500 sm:col-span-3">
                    DAS: precisa do PGDAS-D da competência transmitido (o DAS do MEI, pelo PGMEI, não é gerado aqui). INSS: gera o DARF da DCTFWeb do período (precisa estar transmitida).
                  </p>
                </div>
              )}

              {publicada && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 p-3 text-sm dark:border-emerald-900">
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{publicada.title}</p>
                    <p className="text-xs text-slate-500">
                      {publicada.dueDate ? `vence ${fmtData(publicada.dueDate)}` : "vencimento no PDF"}
                      {publicada.valor != null ? ` · ${brl(publicada.valor)}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {publicada.pixCode && (
                      <button onClick={() => copiar("pub", publicada.pixCode!)} className={BTN_LINHA}>
                        {copiado === "pub" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} PIX
                      </button>
                    )}
                    <button onClick={() => verGuia(publicada.documentId, publicada.title)} className={BTN_FORTE}>
                      <FileText className="h-3.5 w-3.5" /> Ver PDF
                    </button>
                  </div>
                </div>
              )}

              <ul className="mt-3 space-y-2">
                {guiasOrdenadas.length === 0 && <li className="text-sm text-slate-400">Nenhuma guia com vencimento no app deste cliente.</li>}
                {guiasOrdenadas.map((g) => {
                  const s = situacaoGuia(g);
                  const podeRecalcular = (s.tipo === "atrasada" || s.tipo === "aguardando") && g.tipoGuia && COMPETENCIA_OK.test(g.competence ?? "");
                  return (
                    <li key={g.id} className={`rounded-xl border border-l-[3px] border-slate-100 p-3 dark:border-slate-800 ${s.tipo === "atrasada" ? "border-l-red-500" : s.tipo === "paga" ? "border-l-emerald-500 opacity-75" : "border-l-amber-400"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{g.title}</p>
                          <p className="text-xs text-slate-500">
                            {g.competence ? `Competência ${g.competence} · ` : ""}
                            {(dataDe(g.dueDate)?.getTime() ?? 0) < startOfDay(new Date()).getTime() ? "venceu" : "vence"} {fmtData(g.dueDate)}
                            {g.status === "GUIA_ATUALIZADA" ? " · recalculada" : ""}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.chip}`}>{s.rotulo}</span>
                      </div>
                      {g.valor != null && <p className="mt-1 text-base font-bold tabular-nums text-slate-800 dark:text-slate-100">{brl(g.valor)}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {g.temArquivo && (
                          <button onClick={() => verGuia(g.id, g.title)} className={BTN_LINHA}>
                            <FileText className="h-3.5 w-3.5" /> Ver PDF
                          </button>
                        )}
                        {g.pixCode && s.tipo !== "paga" && (
                          <button onClick={() => copiar(g.id, g.pixCode!)} className={BTN_LINHA}>
                            {copiado === g.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copiado === g.id ? "Copiado" : "PIX"}
                          </button>
                        )}
                        {s.tipo !== "paga" ? (
                          <button
                            onClick={() => executar(`pago-${g.id}`, () => marcarGuiaPaga(g.id, true), `“${g.title}” marcada como paga.`)}
                            disabled={!!ocupado}
                            className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-700`}
                            title="Dar baixa: o cliente vê como paga no app"
                          >
                            {ocupado === `pago-${g.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Marcar como pago
                          </button>
                        ) : (
                          <button
                            onClick={() => window.confirm(`Desfazer a baixa de “${g.title}”?`) && executar(`pago-${g.id}`, () => marcarGuiaPaga(g.id, false), "Baixa desfeita.")}
                            disabled={!!ocupado}
                            className={BTN_LINHA}
                          >
                            {ocupado === `pago-${g.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Desfazer baixa
                          </button>
                        )}
                        {podeRecalcular && (
                          <button
                            onClick={() =>
                              window.confirm(`Recalcular "${g.title}" no Integra Contador (1 consulta), com multa e juros até hoje?\n\nA guia nova substitui esta no app do cliente.`) &&
                              gerarGuia(g.tipoGuia!, g.competence!, g.id)
                            }
                            disabled={!!ocupado}
                            className={`${BTN} bg-red-600 text-white hover:bg-red-700`}
                          >
                            {ocupado === `recalc-${g.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            {ocupado === `recalc-${g.id}` ? "Recalculando…" : "Recalcular"}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* ---- parcelamentos ---- */}
            <section className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Parcelamentos cadastrados</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => window.confirm("Buscar parcelamentos do Simples Nacional no SERPRO?\n\nGasta 4 consultas (PARCSN, especial, PERT e RELP) + 1 por parcelamento ativo.") && executar("buscar", () => buscarParcelamentosSerpro(clientId), "Busca concluída:")}
                    disabled={!!ocupado}
                    className={BTN_LINHA}
                  >
                    {ocupado === "buscar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />} Buscar do Simples
                  </button>
                  <button onClick={() => { setForm({ ...VAZIO }); setEditId(null); }} className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-700`}>
                    <Plus className="h-3.5 w-3.5" /> Cadastrar
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                As parcelas em atraso vêm do relatório de situação fiscal. Aqui fica o cadastro de referência (número, valor, vencimento) de cada parcelamento.
              </p>

              {form && (
                <div className="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className={LABEL}>Modalidade</label>
                    <select className={FIELD} value={form.modalidade} disabled={editId != null && form.origem === "serpro"} onChange={(e) => setForm({ ...form, modalidade: e.target.value })}>
                      {MODALIDADES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Número</label>
                    <input className={FIELD} value={form.numero ?? ""} disabled={form.origem === "serpro"} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
                  </div>
                  <div>
                    <label className={LABEL}>Valor da parcela (R$)</label>
                    <input className={FIELD} inputMode="decimal" value={form.valorParcela ?? ""} onChange={(e) => setForm({ ...form, valorParcela: e.target.value as any })} />
                  </div>
                  <div>
                    <label className={LABEL}>Nº de parcelas</label>
                    <input className={FIELD} inputMode="numeric" value={form.parcelasTotal ?? ""} onChange={(e) => setForm({ ...form, parcelasTotal: e.target.value.replace(/\D/g, "") as any })} />
                  </div>
                  <div>
                    <label className={LABEL}>Dia do vencimento</label>
                    <input className={FIELD} inputMode="numeric" value={form.diaVencimento ?? ""} onChange={(e) => setForm({ ...form, diaVencimento: e.target.value.replace(/\D/g, "").slice(0, 2) as any })} />
                  </div>
                  {form.origem !== "serpro" && (
                    <div>
                      <label className={LABEL}>Última parcela paga (MM/AAAA)</label>
                      <input className={FIELD} placeholder="opcional" value={form.ultimoPagamento ?? ""} onChange={(e) => setForm({ ...form, ultimoPagamento: e.target.value })} />
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 sm:col-span-2">
                    <input type="checkbox" checked={form.ativo ?? true} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativo
                  </label>
                  <div className="flex justify-end gap-2 sm:col-span-2">
                    <button onClick={() => { setForm(null); setEditId(null); }} className={`${BTN} text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800`}>Cancelar</button>
                    <button onClick={salvarParcelamento} disabled={!!ocupado || !form.numero} className={`${BTN} bg-slate-900 text-white dark:bg-indigo-600`}>
                      {ocupado === "parc" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Salvar
                    </button>
                  </div>
                </div>
              )}

              <ul className="mt-3 space-y-2">
                {d.parcelamentos.length === 0 && <li className="text-sm text-slate-400">Nenhum parcelamento cadastrado.</li>}
                {d.parcelamentos.map((p) => (
                  <li key={p.id} className={`rounded-xl border p-3 dark:border-slate-800 ${p.ativo ? "border-slate-100" : "border-dashed border-slate-200 opacity-60"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{rotuloModalidade(p.modalidade)} · nº {p.numero}</p>
                        <p className="text-xs text-slate-500">
                          {[p.situacao, p.valorParcela ? `parcela R$ ${p.valorParcela.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : null, p.parcelasTotal ? `${p.parcelasTotal}x` : null, p.diaVencimento ? `vence dia ${p.diaVencimento}` : null, p.ultimoPagamento ? `última paga ${p.ultimoPagamento}` : null, p.origem === "serpro" ? "via SERPRO" : "manual", !p.ativo ? "inativo" : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button onClick={() => { setForm({ ...p, ultimoPagamento: p.ultimoPagamento ?? "" }); setEditId(p.id); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Editar">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => window.confirm("Excluir este parcelamento do painel?") && executar("del", () => excluirParcelamento(p.id))} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label="Excluir">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* ---- perfil ---- */}
            <section className="mt-6 rounded-xl border border-slate-100 p-4 dark:border-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">O que monitorar</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={LABEL}>Regime</label>
                  <select className={FIELD} value={regime} onChange={(e) => setRegime(e.target.value)}>
                    <option value="">Não informado</option>
                    <option value="simples">Simples Nacional</option>
                    <option value="mei">MEI</option>
                    <option value="presumido">Lucro Presumido</option>
                    <option value="real">Lucro Real</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Automático (FGTS só com guia de FGTS)
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {PROCESSOS.map((p) => (
                  <label key={p} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${auto ? "opacity-60" : ""} border-slate-200 dark:border-slate-700 dark:text-slate-200`}>
                    <input
                      type="checkbox"
                      disabled={auto}
                      checked={(auto ? d.processosEfetivos : processos).includes(p)}
                      onChange={(e) => setProcessos(e.target.checked ? [...processos, p] : processos.filter((x) => x !== p))}
                    />
                    {ROTULO[p]}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Sem Omissões, Débitos, Parcelamentos e Dívida ativa marcados, o relatório semanal deste cliente não é emitido.</p>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => executar("perfil", () => salvarPerfilFiscal(clientId, regime || null, auto ? null : processos), "Perfil salvo.")}
                  disabled={!!ocupado}
                  className={`${BTN} bg-slate-900 text-white dark:bg-indigo-600`}
                >
                  {ocupado === "perfil" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Salvar perfil
                </button>
              </div>
            </section>
          </>
        )}
      </aside>
    </div>,
    document.body,
  );
}
