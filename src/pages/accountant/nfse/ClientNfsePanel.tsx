import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Upload,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Power,
} from "lucide-react";
import {
  adminGetClientNfse,
  adminSaveNfseConfig,
  adminCreateAtividade,
  adminUpdateAtividade,
  adminDeleteAtividade,
  adminTestNfseConfig,
  adminSincronizarDistribuicao,
  type AdminClientNfse,
  type NfseAtividade,
  type NfseTestResult,
} from "../../../lib/nfse";
import { AtividadeForm } from "./AtividadeForm";

const FIELD =
  "w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 dark:text-white";
const LABEL = "text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide";
const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("pt-BR");
}

export function ClientNfsePanel({ clientId, onBack }: { clientId: string; onBack: () => void }) {
  const [data, setData] = useState<AdminClientNfse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [test, setTest] = useState<NfseTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const [certFile, setCertFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    codigoMunicipio: "",
    regimeTributario: "simples_nacional",
    ambiente: "homologacao",
    serieDps: "00001",
    certSenha: "",
    optanteSimplesNacional: true,
    incentivoFiscal: false,
  });

  const [editingAtv, setEditingAtv] = useState<NfseAtividade | null | undefined>(undefined);

  const load = async () => {
    setLoading(true);
    try {
      const d = await adminGetClientNfse(clientId);
      setData(d);
      if (d.config) {
        setForm({
          codigoMunicipio: d.config.codigoMunicipio ?? "",
          regimeTributario: d.config.regimeTributario ?? "simples_nacional",
          ambiente: d.config.ambiente ?? "homologacao",
          serieDps: d.config.serieDps ?? "00001",
          certSenha: "",
          optanteSimplesNacional: d.config.optanteSimplesNacional,
          incentivoFiscal: d.config.incentivoFiscal,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    setTest(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const saveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const { warnings } = await adminSaveNfseConfig(
        clientId,
        {
          codigoMunicipio: form.codigoMunicipio,
          regimeTributario: form.regimeTributario,
          ambiente: form.ambiente,
          serieDps: form.serieDps,
          optanteSimplesNacional: String(form.optanteSimplesNacional),
          incentivoFiscal: String(form.incentivoFiscal),
          certSenha: form.certSenha,
        },
        certFile,
      );
      setCertFile(null);
      setForm((f) => ({ ...f, certSenha: "" }));
      setMsg({
        tone: "ok",
        text: warnings.length ? `Salvo. ${warnings.join(" ")}` : "Configuração salva.",
      });
      await load();
    } catch (err: any) {
      setMsg({ tone: "err", text: err.message || "Falha ao salvar." });
    } finally {
      setSaving(false);
    }
  };

  const toggleAtivo = async () => {
    if (!data) return;
    setSaving(true);
    setMsg(null);
    try {
      await adminSaveNfseConfig(clientId, { ativo: String(!data.config?.ativo) });
      await load();
    } catch (err: any) {
      setMsg({ tone: "err", text: err.message || "Falha ao alterar o status." });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await adminTestNfseConfig(clientId));
    } finally {
      setTesting(false);
    }
  };

  const [syncing, setSyncing] = useState(false);
  const buscarPortal = async (reiniciar = false) => {
    setSyncing(true);
    setMsg(null);
    try {
      const r = await adminSincronizarDistribuicao(clientId, reiniciar);
      if (!r.ok) {
        setMsg({ tone: "err", text: r.error || "Falha ao consultar o portal nacional." });
      } else {
        const total = (r.novas ?? 0) + (r.atualizadas ?? 0) + (r.eventos ?? 0);
        setMsg({
          tone: "ok",
          text: total
            ? `Portal nacional: ${r.novas ?? 0} nova(s), ${r.atualizadas ?? 0} vinculada(s), ${r.eventos ?? 0} evento(s).`
            : "Nenhuma nota nova no portal nacional.",
        });
      }
    } finally {
      setSyncing(false);
    }
  };

  const saveAtividade = async (input: Partial<Omit<NfseAtividade, "id">>) => {
    if (editingAtv) {
      await adminUpdateAtividade(clientId, editingAtv.id, input);
    } else {
      await adminCreateAtividade(clientId, input);
    }
    setEditingAtv(undefined);
    await load();
  };

  const removeAtividade = async (a: NfseAtividade) => {
    if (!confirm(`Remover a atividade "${a.nome}"?`)) return;
    await adminDeleteAtividade(clientId, a.id);
    await load();
  };

  if (loading || !data) {
    return (
      <div className="flex items-center gap-2 py-16 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando…
      </div>
    );
  }

  const cfg = data.config;
  const ativas = data.atividades.filter((a) => a.ativo).length;
  const canActivate = !!cfg?.hasCert && ativas > 0;

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> Voltar à lista
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">{data.client.name}</h2>
          <p className="text-sm text-slate-500">{data.client.cnpjFormatado}</p>
        </div>
        <button
          onClick={toggleAtivo}
          disabled={saving || (!cfg?.ativo && !canActivate)}
          className={
            "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors disabled:opacity-40 " +
            (cfg?.ativo
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200")
          }
          title={!cfg?.ativo && !canActivate ? "Envie o certificado e cadastre uma atividade ativa" : ""}
        >
          <Power className="h-4 w-4" />
          {cfg?.ativo ? "Emissão ativa" : "Emissão inativa"}
        </button>
      </div>

      {msg && (
        <div
          className={
            "flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold " +
            (msg.tone === "ok"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300")
          }
        >
          {msg.tone === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {msg.text}
        </div>
      )}

      {/* Certificado + dados fiscais */}
      <form onSubmit={saveConfig} className={CARD + " space-y-5"}>
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          {cfg?.hasCert && !cfg?.certMissing ? (
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
          ) : (
            <ShieldAlert className="h-5 w-5 text-amber-500" />
          )}
          <h3 className="font-bold text-slate-800 dark:text-white">Certificado digital A1 do cliente</h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Arquivo .pfx / .p12</label>
            <div className="mt-1 flex items-center gap-3">
              <input id="cert" type="file" accept=".pfx,.p12" className="hidden" onChange={(e) => setCertFile(e.target.files?.[0] || null)} />
              <label htmlFor="cert" className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <Upload className="h-4 w-4" /> Selecionar
              </label>
              <span className="truncate text-sm text-slate-500">
                {certFile
                  ? certFile.name
                  : cfg?.certMissing
                    ? "Arquivo não encontrado — reenvie"
                    : cfg?.hasCert
                      ? `Salvo · ${cfg.certCnpj ?? "CNPJ n/d"} · válido até ${fmtDate(cfg.certValidadeAte)}`
                      : "Nenhum certificado"}
              </span>
            </div>
          </div>
          <div>
            <label className={LABEL}>Senha do certificado</label>
            <input
              type="password"
              autoComplete="off"
              className={FIELD + " mt-1"}
              placeholder={cfg?.hasCertSenha ? "•••••• (em branco = manter)" : "Senha do arquivo"}
              value={form.certSenha}
              onChange={(e) => setForm({ ...form, certSenha: e.target.value })}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={LABEL}>Município emissor (IBGE)</label>
            <input className={FIELD + " mt-1"} inputMode="numeric" placeholder="7 dígitos" value={form.codigoMunicipio} onChange={(e) => setForm({ ...form, codigoMunicipio: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>Regime tributário</label>
            <select className={FIELD + " mt-1"} value={form.regimeTributario} onChange={(e) => setForm({ ...form, regimeTributario: e.target.value })}>
              <option value="simples_nacional">Simples Nacional</option>
              <option value="mei">MEI</option>
              <option value="normal">Normal / Lucro Presumido</option>
            </select>
          </div>
          <div>
            <label className={LABEL}>Série da DPS</label>
            <input className={FIELD + " mt-1"} value={form.serieDps} onChange={(e) => setForm({ ...form, serieDps: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>Ambiente</label>
            <select className={FIELD + " mt-1"} value={form.ambiente} onChange={(e) => setForm({ ...form, ambiente: e.target.value })}>
              <option value="homologacao">Homologação (produção restrita)</option>
              <option value="producao">Produção</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.optanteSimplesNacional} onChange={(e) => setForm({ ...form, optanteSimplesNacional: e.target.checked })} />
            Optante do Simples Nacional
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.incentivoFiscal} onChange={(e) => setForm({ ...form, incentivoFiscal: e.target.checked })} />
            Incentivador fiscal
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Salvando…" : "Salvar configuração"}
          </button>
          <button type="button" onClick={runTest} disabled={testing || !cfg?.hasCert} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            {testing ? "Testando…" : "Testar certificado"}
          </button>
          <button type="button" onClick={() => buscarPortal(false)} disabled={syncing || !cfg?.hasCert} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            {syncing ? "Buscando…" : "Buscar notas no portal nacional"}
          </button>
          <button type="button" onClick={() => buscarPortal(true)} disabled={syncing || !cfg?.hasCert} title="Recomeça a busca do NSU 0 — use ao trocar de ambiente ou se desconfiar que faltam notas" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
            {syncing ? "…" : "Rebuscar do início"}
          </button>
        </div>

        {test && (
          <div
            className={
              "rounded-xl px-4 py-3 text-sm " +
              (test.ok
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200")
            }
          >
            {test.ok ? (
              <>
                Certificado OK · CNPJ {test.certCnpj ?? "n/d"} · válido até {fmtDate(test.certValidadeAte)}
                {test.certVencido && " · ATENÇÃO: vencido"}
              </>
            ) : (
              <>Falha: {test.error}</>
            )}
          </div>
        )}
      </form>

      {/* Atividades */}
      <div className={CARD}>
        <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <h3 className="font-bold text-slate-800 dark:text-white">
            Atividades pré-configuradas <span className="text-slate-400">({ativas} ativa{ativas === 1 ? "" : "s"})</span>
          </h3>
          <button onClick={() => setEditingAtv(null)} className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-bold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900">
            <Plus className="h-4 w-4" /> Adicionar
          </button>
        </div>

        {data.atividades.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            Nenhuma atividade. Cadastre ao menos uma para habilitar a emissão do cliente.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.atividades.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold text-slate-800 dark:text-white">
                    <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400">{a.itemListaServico}</span>
                    {a.nome}
                    {!a.ativo && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800">inativa</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    ISS {a.aliquotaIss}%{a.issRetido ? " · retido" : ""} · {a.descricaoPadrao || "sem descrição padrão"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => setEditingAtv(a)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => removeAtividade(a)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editingAtv !== undefined && (
        <AtividadeForm initial={editingAtv} onCancel={() => setEditingAtv(undefined)} onSave={saveAtividade} />
      )}
    </div>
  );
}
