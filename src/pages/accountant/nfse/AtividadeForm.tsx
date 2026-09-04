import React, { useEffect, useMemo, useState } from "react";
import { X, Search } from "lucide-react";
import {
  getListaServicos,
  type ServicoLC116,
  type NfseAtividade,
  type AtividadeInput,
} from "../../../lib/nfse";

const FIELD =
  "w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 dark:text-white";
const LABEL = "text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide";
const SECTION =
  "rounded-xl border border-slate-200 p-3.5 text-sm dark:border-slate-800 open:pb-4";
const SUMMARY = "cursor-pointer select-none font-semibold text-slate-700 dark:text-slate-300";
const HINT = "mt-1 text-[11px] leading-snug text-slate-400";

const EXIGIBILIDADE: [string, string][] = [
  ["1", "Exigível"],
  ["2", "Não incidência"],
  ["3", "Isenção"],
  ["4", "Exportação"],
  ["5", "Imunidade"],
  ["6", "Exigibilidade suspensa — decisão judicial"],
  ["7", "Exigibilidade suspensa — processo administrativo"],
];

const TRIB_ISSQN: [string, string][] = [
  ["1", "Operação tributável"],
  ["2", "Imunidade"],
  ["3", "Exportação de serviço"],
  ["4", "Não incidência"],
];

const REG_AP_SN: [string, string][] = [
  ["", "— (não aplicável / usar padrão do SN)"],
  ["1", "Federais e ISSQN apurados pelo Simples Nacional"],
  ["2", "Federais pelo SN, ISSQN por fora (legislação municipal)"],
  ["3", "Federais e ISSQN por fora do SN"],
];

const IND_DEST: [string, string][] = [
  ["0", "O destinatário é o próprio tomador"],
  ["1", "O destinatário é outra pessoa/estabelecimento"],
];

interface Props {
  initial?: NfseAtividade | null;
  onCancel: () => void;
  onSave: (input: Partial<AtividadeInput>) => Promise<void>;
}

type FormState = Partial<AtividadeInput>;

export function AtividadeForm({ initial, onCancel, onSave }: Props) {
  const [servicos, setServicos] = useState<ServicoLC116[]>([]);
  const [servicoQuery, setServicoQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState<FormState>({
    nome: initial?.nome ?? "",
    itemListaServico: initial?.itemListaServico ?? "",
    codTributacaoNac: initial?.codTributacaoNac ?? "",
    codTributacaoMun: initial?.codTributacaoMun ?? "",
    cnae: initial?.cnae ?? "",
    cNbs: initial?.cNbs ?? "",
    descricaoPadrao: initial?.descricaoPadrao ?? "",
    aliquotaIss: initial?.aliquotaIss ?? 0,
    issRetido: initial?.issRetido ?? false,
    tribIssqn: initial?.tribIssqn ?? "1",
    exigibilidadeIss: initial?.exigibilidadeIss ?? "1",
    municipioIncidencia: initial?.municipioIncidencia ?? "",
    regApTribSn: initial?.regApTribSn ?? "",
    codAtividadeSn: initial?.codAtividadeSn ?? "",
    retIrrf: initial?.retIrrf ?? 0,
    retPis: initial?.retPis ?? 0,
    retCofins: initial?.retCofins ?? 0,
    retCsll: initial?.retCsll ?? 0,
    retInss: initial?.retInss ?? 0,
    pisCofinsCst: initial?.pisCofinsCst ?? "",
    aliquotaPis: initial?.aliquotaPis ?? 0,
    aliquotaCofins: initial?.aliquotaCofins ?? 0,
    ibsCbsCst: initial?.ibsCbsCst ?? "",
    ibsCbsClassTrib: initial?.ibsCbsClassTrib ?? "",
    ibsCbsCindOp: initial?.ibsCbsCindOp ?? "",
    ibsCbsIndDest: initial?.ibsCbsIndDest ?? "0",
    ativo: initial?.ativo ?? true,
    ordem: initial?.ordem ?? 0,
  });

  useEffect(() => {
    getListaServicos().then(setServicos).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = servicoQuery.trim().toLowerCase();
    if (!q) return servicos.slice(0, 40);
    const qd = q.replace(/\D/g, "");
    return servicos
      .filter(
        (s) =>
          s.descricao.toLowerCase().includes(q) ||
          s.codigo.includes(q) ||
          (qd.length >= 2 && s.codigo.replace(/\D/g, "").includes(qd)),
      )
      .slice(0, 40);
  }, [servicos, servicoQuery]);

  const set = (patch: FormState) => setForm((f) => ({ ...f, ...patch }));
  const num = (v: string) => {
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  const pickServico = (s: ServicoLC116) => {
    set({
      itemListaServico: s.codigo,
      descricaoPadrao: form.descricaoPadrao || s.descricao,
      nome: form.nome || s.descricao,
    });
    setServicoQuery("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.nome?.trim()) return setError("Informe um nome para a atividade.");
    if (!form.itemListaServico?.trim()) return setError("Selecione o item da lista de serviço (LC 116).");
    setSaving(true);
    try {
      await onSave(form);
    } catch (err: any) {
      setError(err.message || "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  // Funções de render (NÃO componentes) — evitam remontar o input a cada tecla.
  const text = (k: keyof FormState, label: string, placeholder?: string, hint?: string) => (
    <div>
      <label className={LABEL}>{label}</label>
      <input
        className={FIELD + " mt-1"}
        value={String((form as any)[k] ?? "")}
        onChange={(e) => set({ [k]: e.target.value } as FormState)}
        placeholder={placeholder}
      />
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );

  const pct = (k: keyof FormState, label: string) => (
    <div>
      <label className="text-[11px] font-bold uppercase text-slate-500">{label}</label>
      <input
        className={FIELD + " mt-1"}
        inputMode="decimal"
        value={String((form as any)[k] ?? 0)}
        onChange={(e) => set({ [k]: num(e.target.value) } as FormState)}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            {initial ? "Editar atividade" : "Nova atividade"}
          </h3>
          <button onClick={onCancel} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Preencha aqui todos os códigos fiscais. Na emissão, o cliente só informa tomador, descrição e valor.
        </p>

        <form onSubmit={submit} className="space-y-4">
          {/* ---- Serviço ---- */}
          <div>
            <label className={LABEL}>Item da lista de serviço (LC 116/2003)</label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className={FIELD + " pl-9"}
                placeholder={form.itemListaServico ? `Selecionado: ${form.itemListaServico}` : "Buscar por código ou descrição…"}
                value={servicoQuery}
                onChange={(e) => setServicoQuery(e.target.value)}
              />
            </div>
            {servicoQuery && (
              <ul className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-800 dark:bg-slate-950">
                {filtered.map((s) => (
                  <li key={s.codigo}>
                    <button
                      type="button"
                      onClick={() => pickServico(s)}
                      className="flex w-full gap-2 px-3 py-2 text-left hover:bg-indigo-50 dark:hover:bg-slate-800"
                    >
                      <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">{s.codigo}</span>
                      <span className="text-slate-600 dark:text-slate-300">{s.descricao}</span>
                    </button>
                  </li>
                ))}
                {filtered.length === 0 && <li className="px-3 py-2 text-slate-400">Nenhum item encontrado.</li>}
              </ul>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {text("nome", "Nome da atividade")}
            {text("itemListaServico", "Item LC 116", "ex.: 4.16")}
            {text("codTributacaoNac", "Cód. tributação nacional", "6 dígitos", "Aba MUN.INCID_INFO.SERV. do Anexo I. Se em branco, derivado do item LC 116.")}
            {text("codTributacaoMun", "Cód. tributação municipal", "deixe em branco", "Só preencha se o município de incidência publicou os próprios códigos no Sistema Nacional. Código inexistente lá → rejeição E0314. Na dúvida, deixe vazio.")}
            {text("cnae", "CNAE", "7 dígitos")}
            {text("cNbs", "Código NBS", "9 dígitos", "Nomenclatura Brasileira de Serviços 2.0 — Anexo B.")}
          </div>

          <div>
            <label className={LABEL}>Descrição padrão do serviço</label>
            <textarea
              className={FIELD + " mt-1 min-h-[70px]"}
              value={form.descricaoPadrao ?? ""}
              onChange={(e) => set({ descricaoPadrao: e.target.value })}
              placeholder="Pré-preenche a descrição da nota (o cliente pode ajustar)."
            />
          </div>

          {/* ---- ISSQN ---- */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL}>Tributação do ISSQN</label>
              <select className={FIELD + " mt-1"} value={form.tribIssqn ?? "1"} onChange={(e) => set({ tribIssqn: e.target.value })}>
                {TRIB_ISSQN.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Alíquota ISS (%)</label>
              <input className={FIELD + " mt-1"} inputMode="decimal" value={String(form.aliquotaIss ?? 0)} onChange={(e) => set({ aliquotaIss: num(e.target.value) })} />
              <p className={HINT}>Município conveniado ao padrão nacional fornece a alíquota — este valor é usado só como fallback.</p>
            </div>
            <div>
              <label className={LABEL}>Exigibilidade do ISS</label>
              <select className={FIELD + " mt-1"} value={form.exigibilidadeIss ?? "1"} onChange={(e) => set({ exigibilidadeIss: e.target.value })}>
                {EXIGIBILIDADE.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            {text("municipioIncidencia", "Município de incidência (IBGE)", "7 dígitos — se ISS devido em outro município", "Vira o local da prestação (cLocPrestacao) na DPS.")}
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={!!form.issRetido} onChange={(e) => set({ issRetido: e.target.checked })} />
            ISS retido pelo tomador
          </label>

          {/* ---- Simples Nacional ---- */}
          <details className={SECTION}>
            <summary className={SUMMARY}>Simples Nacional</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className={LABEL}>Regime de apuração pelo SN</label>
                <select className={FIELD + " mt-1"} value={form.regApTribSn ?? ""} onChange={(e) => set({ regApTribSn: e.target.value })}>
                  {REG_AP_SN.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                <p className={HINT}>regApTribSN — só para Simples Nacional ME/EPP que ultrapassou sublimite.</p>
              </div>
              {text("codAtividadeSn", "Código da atividade SN", "ex.: 7, 8, 9…", "cAtvSN (LC 123/2006, NT-009). Capturado; enviado quando o layout entrar em produção.")}
            </div>
          </details>

          {/* ---- Retenções federais ---- */}
          <details className={SECTION}>
            <summary className={SUMMARY}>Retenções federais (%)</summary>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {pct("retIrrf", "IRRF")}
              {pct("retPis", "PIS")}
              {pct("retCofins", "COFINS")}
              {pct("retCsll", "CSLL")}
              {pct("retInss", "INSS (CP)")}
            </div>
            <p className={HINT}>Valores retidos: IRRF → vRetIRRF, CSLL → vRetCSLL, INSS → vRetCP. PIS/COFINS retidos entram no bloco abaixo.</p>
          </details>

          {/* ---- PIS/COFINS apuração própria ---- */}
          <details className={SECTION}>
            <summary className={SUMMARY}>PIS / COFINS — apuração própria</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {text("pisCofinsCst", "CST PIS/COFINS", "2 dígitos (ex.: 01, 07…)", "Deixe em branco para não emitir o bloco piscofins (padrão p/ Simples).")}
              <div>
                <label className="text-[11px] font-bold uppercase text-slate-500">Alíquota PIS (%)</label>
                <input className={FIELD + " mt-1"} inputMode="decimal" value={String(form.aliquotaPis ?? 0)} onChange={(e) => set({ aliquotaPis: num(e.target.value) })} />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-slate-500">Alíquota COFINS (%)</label>
                <input className={FIELD + " mt-1"} inputMode="decimal" value={String(form.aliquotaCofins ?? 0)} onChange={(e) => set({ aliquotaCofins: num(e.target.value) })} />
              </div>
            </div>
          </details>

          {/* ---- IBS / CBS ---- */}
          <details className={SECTION}>
            <summary className={SUMMARY}>IBS / CBS — Reforma Tributária</summary>
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              Os códigos são guardados agora. O grupo IBS/CBS só é enviado na DPS quando
              <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-900/40">NFSE_IBSCBS_ENVIAR=1</code>
              e a NT-009 estiver em produção.
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {text("ibsCbsCst", "CST IBS/CBS", "3 dígitos", "Anexo VII (IndOp/IBSCBS).")}
              {text("ibsCbsClassTrib", "cClassTrib", "6 dígitos", "Anexo VIII (classificação tributária).")}
              {text("ibsCbsCindOp", "cIndOp", "6 dígitos", "Código indicador da operação — Anexo VII.")}
            </div>
            <div className="mt-3">
              <label className={LABEL}>Indicador do destinatário</label>
              <select className={FIELD + " mt-1"} value={form.ibsCbsIndDest ?? "0"} onChange={(e) => set({ ibsCbsIndDest: e.target.value })}>
                {IND_DEST.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </details>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.ativo ?? true} onChange={(e) => set({ ativo: e.target.checked })} />
            Atividade ativa (disponível para o cliente selecionar)
          </label>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? "Salvando…" : "Salvar atividade"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
