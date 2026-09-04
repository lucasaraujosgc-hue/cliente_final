import { useEffect, useMemo, useState } from "react";
import {
  FileText,
  Search,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Download,
  Trash2,
} from "lucide-react";
import { cnpjMatches } from "../../../lib/cnpj";
import {
  adminListNfseClients,
  adminListNfseEmissoes,
  adminDownloadEmissaoXml,
  adminExcluirEmissao,
  centavosToBRL,
  nfseStatusLabel,
  type NfseClientOverview,
  type NfseEmissaoDetail,
} from "../../../lib/nfse";
import { ClientNfsePanel } from "./ClientNfsePanel";

type Tab = "clients" | "emissoes";

export function AccountantNfse() {
  const [tab, setTab] = useState<Tab>("clients");
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          <FileText className="h-6 w-6 text-indigo-500" />
          NFS-e — Emissão
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Certificado A1 e atividades por cliente. O cliente só emite quando há certificado, ao menos
          uma atividade ativa e a emissão está ligada.
        </p>
      </div>

      {!selected && (
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
          {(["clients", "emissoes"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "px-4 py-2 text-sm font-bold transition-colors " +
                (tab === t
                  ? "border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200")
              }
            >
              {t === "clients" ? "Clientes" : "Notas emitidas"}
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <ClientNfsePanel clientId={selected} onBack={() => setSelected(null)} />
      ) : tab === "clients" ? (
        <ClientsTab onSelect={setSelected} />
      ) : (
        <EmissoesTab />
      )}
    </div>
  );
}

function StatusDot({ c }: { c: NfseClientOverview }) {
  if (c.ativo) return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (c.certVencido) return <AlertTriangle className="h-4 w-4 text-red-500" />;
  if (c.configured) return <Circle className="h-4 w-4 text-amber-500" />;
  return <Circle className="h-4 w-4 text-slate-300 dark:text-slate-600" />;
}

function ClientsTab({ onSelect }: { onSelect: (id: string) => void }) {
  const [rows, setRows] = useState<NfseClientOverview[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminListNfseClients()
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || cnpjMatches(r.cnpj, q)),
    [rows, q],
  );

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          placeholder="Buscar cliente…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <p className="p-8 text-center text-sm text-slate-400">Carregando…</p>
        ) : filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">Nenhum cliente.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((c) => (
              <li key={c.clientId}>
                <button
                  onClick={() => onSelect(c.clientId)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <StatusDot c={c} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-800 dark:text-white">{c.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {c.cnpjFormatado}
                      {c.configured && (
                        <>
                          {" · "}
                          {c.ativo ? "ativa" : c.certVencido ? "certificado vencido" : "configurando"}
                          {" · "}
                          {c.atividadesAtivas} atividade{c.atividadesAtivas === 1 ? "" : "s"}
                          {c.emissoes > 0 && ` · ${c.emissoes} nota${c.emissoes === 1 ? "" : "s"}`}
                        </>
                      )}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmissoesTab() {
  const [rows, setRows] = useState<(NfseEmissaoDetail & { clientId: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [xmlErr, setXmlErr] = useState("");

  useEffect(() => {
    adminListNfseEmissoes()
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  const baixar = async (id: string, tipo: "dps" | "nfse") => {
    setXmlErr("");
    try {
      await adminDownloadEmissaoXml(id, tipo);
    } catch (e: any) {
      setXmlErr(e.message || "Falha ao baixar o XML.");
    }
  };

  const excluir = async (id: string) => {
    if (!window.confirm("Excluir esta tentativa rejeitada? Ela some da lista definitivamente.")) return;
    setXmlErr("");
    const r = await adminExcluirEmissao(id);
    if (!r.ok) return setXmlErr(r.error || "Falha ao excluir.");
    setRows((prev) => prev.filter((x) => x.id !== id));
  };

  if (loading) return <p className="p-8 text-center text-sm text-slate-400">Carregando…</p>;
  if (rows.length === 0) return <p className="p-8 text-center text-sm text-slate-400">Nenhuma nota emitida ainda.</p>;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {xmlErr && <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">{xmlErr}</p>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((e) => {
          const s = nfseStatusLabel(e.status);
          const isOpen = open === e.id;
          return (
            <li key={e.id} className="text-sm">
              <button
                onClick={() => setOpen(isOpen ? null : e.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-800 dark:text-white">
                      {e.tomadorNome || e.tomadorDoc || "—"}
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span>
                        {e.numeroNota ? `Nota ${e.numeroNota}` : "sem número"} ·{" "}
                        {new Date(e.dataEmissao || e.createdAt).toLocaleDateString("pt-BR")}
                        {e.ambiente ? ` · ${e.ambiente}` : ""}
                      </span>
                      {e.origem === "distribuicao" && (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800">
                          portal nacional
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tabular-nums font-semibold text-slate-700 dark:text-slate-200">
                    {centavosToBRL(e.valorServicos)}
                  </span>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[11px] font-bold " +
                      (s.tone === "ok"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        : s.tone === "danger"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                          : s.tone === "warn"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")
                    }
                  >
                    {s.label}
                  </span>
                </div>
              </button>

              {isOpen && (
                <div className="space-y-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="grid gap-1 sm:grid-cols-2">
                    <p><span className="font-semibold text-slate-500">Id da DPS:</span> <span className="font-mono">{e.idDps || "—"}</span></p>
                    <p><span className="font-semibold text-slate-500">Série / Nº DPS:</span> {e.serieDps || "—"} / {e.numeroDps ?? "—"}</p>
                    <p><span className="font-semibold text-slate-500">Chave de acesso:</span> <span className="font-mono break-all">{e.chaveAcesso || "—"}</span></p>
                    <p><span className="font-semibold text-slate-500">verAplic Sefin:</span> {e.versaoAplicativo || "—"}</p>
                  </div>

                  {(e.rejeicaoCodigo || e.rejeicaoMotivo || e.erroMsg) && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
                      <p className="font-bold">
                        Rejeição {e.rejeicaoCodigo ? `· código ${e.rejeicaoCodigo}` : ""}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words">{e.rejeicaoMotivo || e.erroMsg}</p>
                    </div>
                  )}

                  {Array.isArray(e.alertas) && e.alertas.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                      <p className="font-bold">Alertas do Sefin</p>
                      <ul className="mt-1 list-disc pl-4">
                        {e.alertas.map((a, i) => (
                          <li key={i}>{a.codigo ? `[${a.codigo}] ` : ""}{a.mensagem}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {e.hasXmlDps && (
                      <button onClick={() => baixar(e.id, "dps")} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                        <Download className="h-3.5 w-3.5" /> XML da DPS
                      </button>
                    )}
                    {e.hasXmlNfse && (
                      <button onClick={() => baixar(e.id, "nfse")} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                        <Download className="h-3.5 w-3.5" /> XML da NFS-e
                      </button>
                    )}
                    {e.status === "rejeitada" && (
                      <button onClick={() => excluir(e.id)} className="flex items-center gap-1.5 rounded-lg border border-red-300 px-2.5 py-1.5 font-semibold text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-900/20">
                        <Trash2 className="h-3.5 w-3.5" /> Excluir tentativa
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
