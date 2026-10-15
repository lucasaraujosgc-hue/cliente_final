import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { X, Loader2, RefreshCw, CloudDownload, Plus, Trash2, Pencil, Save } from "lucide-react";
import {
  getClienteFiscal,
  atualizarClienteFiscal,
  salvarPerfilFiscal,
  criarParcelamento,
  editarParcelamento,
  excluirParcelamento,
  buscarParcelamentosSerpro,
  PROCESSOS,
  ROTULO,
  SITUACAO_ROTULO,
  type DetalheClienteFiscal,
  type Parcelamento,
  type Processo,
  type Situacao,
} from "../../../lib/fiscal";
import { formatCnpj } from "../../../lib/cnpj";
import { COR } from "../Fiscal";

const FIELD = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white";
const LABEL = "text-[11px] font-bold uppercase tracking-wide text-slate-500";
const BTN = "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50";

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

interface Props {
  clientId: string;
  onClose: () => void;
  onChange: () => void;
}

export function ClienteFiscalDrawer({ clientId, onClose, onChange }: Props) {
  const [d, setD] = useState<(DetalheClienteFiscal & { status: any[] }) | null>(null);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [regime, setRegime] = useState<string>("");
  const [auto, setAuto] = useState(true);
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [form, setForm] = useState<Partial<Parcelamento> | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const load = () =>
    getClienteFiscal(clientId)
      .then((x: any) => {
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{d?.cliente.nome ?? "…"}</h2>
            {d && <p className="text-xs text-slate-500">{formatCnpj(d.cliente.cnpj)}</p>}
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
            {/* ---- situação ---- */}
            <section className="mt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Situação</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => executar("local", () => atualizarClienteFiscal(clientId, false), "Situação recalculada.")}
                    disabled={!!ocupado}
                    className={`${BTN} border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800`}
                    title="Recalcula pelas guias do portal — sem consultar o SERPRO"
                  >
                    {ocupado === "local" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Recalcular
                  </button>
                  <button
                    onClick={() => window.confirm("Consultar o SERPRO para este cliente?\n\nGasta 1 consulta por processo sem guia publicada (PGDAS-D / DCTFWeb) e 1 por parcelamento do Simples.") && executar("serpro", () => atualizarClienteFiscal(clientId, true), "Consulta ao SERPRO concluída.")}
                    disabled={!!ocupado}
                    className={`${BTN} bg-slate-900 text-white hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500`}
                  >
                    {ocupado === "serpro" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />} Consultar SERPRO
                  </button>
                </div>
              </div>
              <ul className="mt-3 space-y-2">
                {PROCESSOS.filter((p) => statusDe(p)).map((p) => {
                  const s = statusDe(p)!;
                  return (
                    <li key={p} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{ROTULO[p]}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${COR[s.status as Situacao].chip}`}>{SITUACAO_ROTULO[s.status as Situacao]}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{s.resumo}</p>
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

            {/* ---- parcelamentos ---- */}
            <section className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Parcelamentos</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => window.confirm("Buscar parcelamentos do Simples Nacional no SERPRO?\n\nGasta 4 consultas (PARCSN, especial, PERT e RELP) + 1 por parcelamento ativo.") && executar("buscar", () => buscarParcelamentosSerpro(clientId), "Busca concluída:")}
                    disabled={!!ocupado}
                    className={`${BTN} border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800`}
                  >
                    {ocupado === "buscar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />} Buscar do Simples
                  </button>
                  <button onClick={() => { setForm({ ...VAZIO }); setEditId(null); }} className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-700`}>
                    <Plus className="h-3.5 w-3.5" /> Cadastrar
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                INSS (SIPADE) e União/PGFN não têm consulta no Integra Contador: cadastre aqui e a situação vem das guias “Parcelamento” publicadas no portal.
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
                  <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Automático (pelas guias publicadas)
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
    </div>
  );
}
