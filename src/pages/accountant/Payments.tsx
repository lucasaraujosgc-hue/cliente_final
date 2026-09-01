import { apiFetch } from "../../lib/apiClient";
import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Receipt,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Clock,
} from "lucide-react";

interface Guia {
  documentId: string;
  clientId: string;
  clientName: string;
  title: string;
  category: string;
  competence: string | null;
  dueDate: string | null;
  value: number | null;
  paymentStatus: string;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  checkAttempts: number;
}

interface BatchResult {
  selected: number;
  checked: number;
  paid: number;
  notFound: number;
  errors: number;
  notApplicable: number;
  ranAt: string;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  if (d.includes("-")) {
    const [y, m, day] = d.split("T")[0].split("-");
    return `${day}/${m}/${y}`;
  }
  return d;
};

// Rótulos amigáveis para as categorias mais comuns; qualquer outra cai no
// próprio valor cru.
const CATEGORY_LABEL: Record<string, string> = {
  DAS_SIMPLES: "DAS — Simples Nacional",
  DCTFWEB: "DCTFWeb",
  DCTFWEB_INSS: "DCTFWeb / INSS",
  taxes: "Impostos",
  webhook_doc: "Outros (integração)",
};
const catLabel = (c: string) => CATEGORY_LABEL[c] || c;

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  PAGO: { text: "Pago", cls: "bg-emerald-100 text-emerald-700" },
  PENDENTE: { text: "Pendente", cls: "bg-amber-100 text-amber-700" },
  ERRO: { text: "Erro", cls: "bg-rose-100 text-rose-700" },
  NAO_APLICAVEL: { text: "N/A", cls: "bg-slate-100 text-slate-500" },
  SEM_CONSULTA: { text: "Sem consulta", cls: "bg-slate-100 text-slate-500" },
};

export function AccountantPayments() {
  const [guias, setGuias] = useState<Guia[] | null>(null);
  const [clientFilter, setClientFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmingManual, setConfirmingManual] = useState(false);

  const load = async () => {
    setError("");
    try {
      const res = await apiFetch("/api/accountant/payments", {}, "accountant");
      const data = await res.json();
      setGuias(data.guias || []);
    } catch {
      setGuias([]);
      setError("Não foi possível carregar as guias pendentes.");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const clients = useMemo(() => {
    const map = new Map<string, string>();
    (guias || []).forEach((g) => map.set(g.clientId, g.clientName));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [guias]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    (guias || []).forEach((g) => g.category && set.add(g.category));
    return [...set].sort((a, b) => catLabel(a).localeCompare(catLabel(b)));
  }, [guias]);

  const visible = useMemo(
    () =>
      (guias || []).filter(
        (g) =>
          (!clientFilter || g.clientId === clientFilter) &&
          (!categoryFilter || g.category === categoryFilter),
      ),
    [guias, clientFilter, categoryFilter],
  );

  // Any change to the selection or the filters cancels a pending manual-mark
  // confirmation.
  useEffect(() => {
    setConfirmingManual(false);
  }, [selected, clientFilter, categoryFilter]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(new Set(visible.map((g) => g.documentId)));
  };
  const clearSelection = () => setSelected(new Set());

  const runCheck = async (body: object) => {
    setRunning(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      const res = await apiFetch(
        Array.isArray((body as any).documentIds)
          ? "/api/accountant/payments/check"
          : "/api/accountant/payments/check-client",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        "accountant",
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha na consulta.");
      setResult(data);
      await load();
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message || "Falha na consulta.");
    } finally {
      setRunning(false);
    }
  };

  // "Informar pagamento manual": 1º clique arma a confirmação, 2º executa.
  const runManualMark = async () => {
    if (!confirmingManual) {
      setConfirmingManual(true);
      return;
    }
    setRunning(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      const res = await apiFetch(
        "/api/accountant/payments/mark-paid",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentIds: [...selected] }),
        },
        "accountant",
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao marcar pagamento.");
      setNotice(
        `${data.marked} guia(s) marcada(s) como paga(s)` +
          (data.skipped ? ` (${data.skipped} já paga(s) ou sem guia).` : "."),
      );
      await load();
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message || "Falha ao marcar pagamento.");
    } finally {
      setRunning(false);
      setConfirmingManual(false);
    }
  };

  const stats = [
    { label: "Selecionadas", value: result?.selected, Icon: Receipt, tone: "text-slate-600 bg-slate-100" },
    { label: "Consultadas", value: result?.checked, Icon: RefreshCw, tone: "text-blue-600 bg-blue-100" },
    { label: "Pagamentos encontrados", value: result?.paid, Icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-100" },
    { label: "Não identificados", value: result?.notFound, Icon: HelpCircle, tone: "text-amber-600 bg-amber-100" },
    { label: "Erros", value: result?.errors, Icon: AlertTriangle, tone: "text-rose-600 bg-rose-100" },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Receipt className="w-6 h-6 text-emerald-500" />
            Consulta de pagamentos
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Consulte no Integra Contador se as guias federais (DAS / DARF / DCTFWeb) já foram pagas.
            O portal do cliente também agenda consultas automáticas.
          </p>
        </div>
        <button
          onClick={load}
          className="self-start flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <RefreshCw className="w-4 h-4" /> Atualizar lista
        </button>
      </header>

      {result && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stats.map((s) => (
            <div
              key={s.label}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.tone}`}>
                <s.Icon className="w-4 h-4" />
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white leading-none tabular-nums">
                {s.value ?? "–"}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {result && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" /> Última consulta:{" "}
          {format(parseISO(result.ranAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
        </p>
      )}

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-400 text-sm font-medium">
          {error}
        </div>
      )}

      {notice && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-700 dark:text-emerald-400 text-sm font-medium">
          {notice}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
          <select
            value={clientFilter}
            onChange={(e) => {
              setClientFilter(e.target.value);
              setSelected(new Set());
            }}
            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm dark:text-white"
          >
            <option value="">Todas as empresas</option>
            {clients.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>

          {categories.length > 1 && (
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setSelected(new Set());
              }}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm dark:text-white"
            >
              <option value="">Todas as categorias</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {catLabel(c)}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-2 text-xs">
            <button onClick={selectAllVisible} className="font-semibold text-emerald-600 hover:text-emerald-700">
              Selecionar {visible.length}
            </button>
            {selected.size > 0 && (
              <button onClick={clearSelection} className="text-slate-500 hover:text-slate-700">
                Limpar seleção
              </button>
            )}
          </div>

          <div className="sm:ml-auto flex flex-wrap gap-2">
            {clientFilter && (
              <button
                disabled={running || visible.length === 0}
                onClick={() => runCheck({ clientId: clientFilter })}
                className="px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                Consultar toda a empresa
              </button>
            )}
            <button
              disabled={running || selected.size === 0}
              onClick={() => runCheck({ documentIds: [...selected] })}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
            >
              {running ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Consultando…
                </>
              ) : (
                <>Consultar selecionadas ({selected.size})</>
              )}
            </button>
            <button
              disabled={running || selected.size === 0}
              onClick={runManualMark}
              onBlur={() => setConfirmingManual(false)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border disabled:opacity-50 ${
                confirmingManual
                  ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                  : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              {confirmingManual
                ? `Confirmar pagamento manual (${selected.size})`
                : `Informar pagamento manual (${selected.size})`}
            </button>
          </div>
        </div>

        {guias === null ? (
          <div className="p-10 text-center text-slate-400 text-sm">Carregando…</div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            Nenhuma guia federal pendente.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-2.5 w-8"></th>
                  <th className="px-3 py-2.5">Empresa</th>
                  <th className="px-3 py-2.5">Guia</th>
                  <th className="px-3 py-2.5">Vencimento</th>
                  <th className="px-3 py-2.5 text-right">Valor</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Última consulta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                {visible.map((g) => {
                  const st = STATUS_LABEL[g.paymentStatus] || STATUS_LABEL.SEM_CONSULTA;
                  return (
                    <tr key={g.documentId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(g.documentId)}
                          onChange={() => toggle(g.documentId)}
                          className="rounded border-slate-300 text-emerald-600"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">{g.clientName}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-slate-900 dark:text-white">{g.title}</span>
                        {g.competence && (
                          <span className="block text-[11px] text-slate-400">Comp. {g.competence}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 tabular-nums">
                        {fmtDate(g.dueDate)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-800 dark:text-slate-200 tabular-nums">
                        {g.value != null ? brl(g.value) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>
                          {st.text}
                        </span>
                        {g.checkAttempts > 0 && (
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            {g.checkAttempts} tentativa(s)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-slate-500 tabular-nums">
                        {g.lastCheckedAt
                          ? format(parseISO(g.lastCheckedAt), "dd/MM HH:mm", { locale: ptBR })
                          : g.nextCheckAt
                            ? `agendada p/ ${format(parseISO(g.nextCheckAt), "dd/MM", { locale: ptBR })}`
                            : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
