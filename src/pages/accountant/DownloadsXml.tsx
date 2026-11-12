import { useEffect, useMemo, useState } from "react";
import { FileDown, Loader2, Search, CheckCircle2, AlertTriangle } from "lucide-react";
import { adminBaixarZipXml, adminResumoXml, type ResumoXmlEmpresa, type TipoXml } from "../../lib/nfse";
import { formatCnpj } from "../../lib/cnpj";

// Downloads: XML das NFS-e por empresa e período (competência), em .zip — um
// arquivo por empresa, com Prestados/ e Tomados/ separados dentro
// (services/nfse/exportacao.ts).

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const FIELD =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
const LABEL = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";

function mesAnterior(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Situacao = { tipo: "ok"; arquivo: string } | { tipo: "erro"; msg: string } | { tipo: "baixando" };

export function DownloadsXml() {
  const [de, setDe] = useState(mesAnterior);
  const [ate, setAte] = useState(mesAnterior);
  const [tipos, setTipos] = useState<Record<TipoXml, boolean>>({ prestados: true, tomados: true });
  const [empresas, setEmpresas] = useState<ResumoXmlEmpresa[] | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [baixando, setBaixando] = useState<{ feitos: number; total: number } | null>(null);
  const [situacao, setSituacao] = useState<Record<string, Situacao>>({});

  const periodoOk = /^\d{4}-\d{2}$/.test(de) && /^\d{4}-\d{2}$/.test(ate) && de <= ate;
  const tiposEscolhidos = (Object.keys(tipos) as TipoXml[]).filter((t) => tipos[t]);

  useEffect(() => {
    if (!periodoOk) return;
    let vivo = true;
    setEmpresas(null);
    setErro("");
    setSituacao({});
    adminResumoXml(de, ate)
      .then((l) => {
        if (!vivo) return;
        setEmpresas(l);
        // mantém só as seleções que continuam com nota no período
        setSel((s) => new Set([...s].filter((id) => l.some((e) => e.clientId === id))));
      })
      .catch((e) => vivo && setErro(e.message));
    return () => {
      vivo = false;
    };
  }, [de, ate, periodoOk]);

  const notasDe = (e: ResumoXmlEmpresa) => (tipos.prestados ? e.prestados : 0) + (tipos.tomados ? e.tomados : 0);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qd = busca.replace(/\D/g, "");
    return (empresas ?? []).filter((e) => !q || e.nome.toLowerCase().includes(q) || (qd && e.cnpj.includes(qd)));
  }, [empresas, busca]);
  const selecionaveis = visiveis.filter((e) => notasDe(e) > 0);
  const escolhidas = (empresas ?? []).filter((e) => sel.has(e.clientId) && notasDe(e) > 0);
  const todasMarcadas = selecionaveis.length > 0 && selecionaveis.every((e) => sel.has(e.clientId));

  const alternar = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const alternarTodas = () =>
    setSel((s) => {
      const n = new Set(s);
      for (const e of selecionaveis) {
        if (todasMarcadas) n.delete(e.clientId);
        else n.add(e.clientId);
      }
      return n;
    });

  // Um .zip por empresa, um depois do outro (o navegador pode pedir para
  // permitir vários downloads na primeira vez).
  const baixar = async () => {
    setBaixando({ feitos: 0, total: escolhidas.length });
    for (const [i, e] of escolhidas.entries()) {
      setSituacao((s) => ({ ...s, [e.clientId]: { tipo: "baixando" } }));
      try {
        const arquivo = await adminBaixarZipXml(e.clientId, de, ate, tiposEscolhidos);
        setSituacao((s) => ({ ...s, [e.clientId]: { tipo: "ok", arquivo } }));
      } catch (err: any) {
        setSituacao((s) => ({ ...s, [e.clientId]: { tipo: "erro", msg: err.message } }));
      }
      setBaixando({ feitos: i + 1, total: escolhidas.length });
      await espera(600);
    }
    setBaixando(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Downloads</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          XML das notas fiscais de serviço (NFS-e) emitidas e tomadas, por empresa e competência. Cada empresa sai num .zip
          próprio, com as pastas <strong>Prestados</strong> e <strong>Tomados</strong> separadas.
        </p>
      </div>

      <div className={CARD + " grid gap-4 sm:grid-cols-[1fr_1fr_auto]"}>
        <div>
          <label className={LABEL}>Competência de</label>
          <input type="month" className={FIELD} value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>até</label>
          <input type="month" className={FIELD} value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
        </div>
        <div>
          <span className={LABEL}>Notas</span>
          <div className="flex gap-3 pt-1.5 text-sm text-slate-700 dark:text-slate-200">
            {(["prestados", "tomados"] as const).map((t) => (
              <label key={t} className="flex items-center gap-1.5">
                <input type="checkbox" checked={tipos[t]} onChange={(e) => setTipos((x) => ({ ...x, [t]: e.target.checked }))} />
                {t === "prestados" ? "Prestados (emitidas)" : "Tomados (recebidas)"}
              </label>
            ))}
          </div>
        </div>
        {!periodoOk && <p className="text-xs font-semibold text-red-600 sm:col-span-3">O mês inicial precisa ser antes do final.</p>}
      </div>

      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input className={FIELD + " pl-9"} placeholder="Buscar empresa ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <button
            onClick={baixar}
            disabled={!escolhidas.length || !tiposEscolhidos.length || !!baixando}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-white dark:text-slate-900"
          >
            {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            {baixando
              ? `Gerando ${Math.min(baixando.feitos + 1, baixando.total)} de ${baixando.total}…`
              : escolhidas.length
                ? `Baixar ${escolhidas.length} zip${escolhidas.length === 1 ? "" : "s"}`
                : "Baixar zips"}
          </button>
        </div>

        {erro && <p className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">{erro}</p>}
        {!empresas && !erro && periodoOk && (
          <p className="flex items-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
        )}
        {empresas && empresas.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">Nenhuma empresa com nota fiscal (XML) nesse período.</p>
        )}

        {empresas && empresas.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-800">
                  <th className="w-10 py-2">
                    <input type="checkbox" checked={todasMarcadas} onChange={alternarTodas} aria-label="Selecionar todas" />
                  </th>
                  <th className="py-2 pr-3">Empresa</th>
                  <th className="px-2 text-right">Prestados</th>
                  <th className="px-2 text-right">Tomados</th>
                  <th className="px-2">Situação</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((e) => {
                  const st = situacao[e.clientId];
                  const vazia = notasDe(e) === 0;
                  return (
                    <tr key={e.clientId} className={"border-b border-slate-100 dark:border-slate-800/60 " + (vazia ? "opacity-50" : "")}>
                      <td className="py-2.5">
                        <input type="checkbox" checked={sel.has(e.clientId) && !vazia} disabled={vazia} onChange={() => alternar(e.clientId)} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <p className="font-semibold text-slate-800 dark:text-white">{e.nome}</p>
                        <p className="font-mono text-xs text-slate-500">{formatCnpj(e.cnpj)}</p>
                      </td>
                      <td className={"px-2 text-right tabular-nums " + (tipos.prestados ? "" : "text-slate-300 dark:text-slate-600")}>{e.prestados}</td>
                      <td className={"px-2 text-right tabular-nums " + (tipos.tomados ? "" : "text-slate-300 dark:text-slate-600")}>{e.tomados}</td>
                      <td className="px-2 text-xs">
                        {st?.tipo === "baixando" && <span className="flex items-center gap-1 text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> gerando…</span>}
                        {st?.tipo === "ok" && <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> baixado</span>}
                        {st?.tipo === "erro" && <span className="flex items-center gap-1 text-red-600 dark:text-red-400"><AlertTriangle className="h-3.5 w-3.5" /> {st.msg}</span>}
                        {!st && e.canceladas > 0 && <span className="text-slate-400">{e.canceladas} cancelada(s), em pasta à parte</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visiveis.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Nenhuma empresa com esse nome ou CNPJ.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
