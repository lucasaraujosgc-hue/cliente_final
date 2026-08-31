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

const EXIGIBILIDADE: [string, string][] = [
  ["1", "Exigível"],
  ["2", "Não incidência"],
  ["3", "Isenção"],
  ["4", "Exportação"],
  ["5", "Imunidade"],
  ["6", "Exigibilidade suspensa — decisão judicial"],
  ["7", "Exigibilidade suspensa — processo administrativo"],
];

interface Props {
  initial?: NfseAtividade | null;
  onCancel: () => void;
  onSave: (input: Partial<AtividadeInput>) => Promise<void>;
}

export function AtividadeForm({ initial, onCancel, onSave }: Props) {
  const [servicos, setServicos] = useState<ServicoLC116[]>([]);
  const [servicoQuery, setServicoQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState<Partial<AtividadeInput>>({
    nome: initial?.nome ?? "",
    itemListaServico: initial?.itemListaServico ?? "",
    codTributacaoNac: initial?.codTributacaoNac ?? "",
    codTributacaoMun: initial?.codTributacaoMun ?? "",
    cnae: initial?.cnae ?? "",
    descricaoPadrao: initial?.descricaoPadrao ?? "",
    aliquotaIss: initial?.aliquotaIss ?? 0,
    issRetido: initial?.issRetido ?? false,
    exigibilidadeIss: initial?.exigibilidadeIss ?? "1",
    municipioIncidencia: initial?.municipioIncidencia ?? "",
    retIrrf: initial?.retIrrf ?? 0,
    retPis: initial?.retPis ?? 0,
    retCofins: initial?.retCofins ?? 0,
    retCsll: initial?.retCsll ?? 0,
    retInss: initial?.retInss ?? 0,
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

  const set = (patch: Partial<AtividadeInput>) => setForm((f) => ({ ...f, ...patch }));
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            {initial ? "Editar atividade" : "Nova atividade"}
          </h3>
          <button onClick={onCancel} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {/* Busca LC116 */}
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
            <div>
              <label className={LABEL}>Nome da atividade</label>
              <input className={FIELD + " mt-1"} value={form.nome ?? ""} onChange={(e) => set({ nome: e.target.value })} />
            </div>
            <div>
              <label className={LABEL}>Item LC 116</label>
              <input className={FIELD + " mt-1"} value={form.itemListaServico ?? ""} onChange={(e) => set({ itemListaServico: e.target.value })} placeholder="ex.: 4.16" />
            </div>
            <div>
              <label className={LABEL}>Cód. tributação nacional</label>
              <input className={FIELD + " mt-1"} value={form.codTributacaoNac ?? ""} onChange={(e) => set({ codTributacaoNac: e.target.value })} placeholder="6 dígitos" />
            </div>
            <div>
              <label className={LABEL}>Cód. tributação municipal</label>
              <input className={FIELD + " mt-1"} value={form.codTributacaoMun ?? ""} onChange={(e) => set({ codTributacaoMun: e.target.value })} />
            </div>
            <div>
              <label className={LABEL}>CNAE</label>
              <input className={FIELD + " mt-1"} value={form.cnae ?? ""} onChange={(e) => set({ cnae: e.target.value })} />
            </div>
            <div>
              <label className={LABEL}>Alíquota ISS (%)</label>
              <input className={FIELD + " mt-1"} inputMode="decimal" value={String(form.aliquotaIss ?? 0)} onChange={(e) => set({ aliquotaIss: num(e.target.value) })} />
            </div>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL}>Exigibilidade do ISS</label>
              <select className={FIELD + " mt-1"} value={form.exigibilidadeIss ?? "1"} onChange={(e) => set({ exigibilidadeIss: e.target.value })}>
                {EXIGIBILIDADE.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <label className="mt-6 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={!!form.issRetido} onChange={(e) => set({ issRetido: e.target.checked })} />
              ISS retido pelo tomador
            </label>
          </div>

          <details className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
            <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
              Retenções federais (%)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(["retIrrf", "retPis", "retCofins", "retCsll", "retInss"] as const).map((k) => (
                <div key={k}>
                  <label className="text-[11px] font-bold uppercase text-slate-500">{k.replace("ret", "")}</label>
                  <input
                    className={FIELD + " mt-1"}
                    inputMode="decimal"
                    value={String((form as any)[k] ?? 0)}
                    onChange={(e) => set({ [k]: num(e.target.value) } as any)}
                  />
                </div>
              ))}
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
