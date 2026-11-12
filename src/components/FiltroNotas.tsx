import { useState } from "react";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import { FILTRO_VAZIO, filtroAtivo, type FiltroNotas } from "../lib/filtroNotas";

// Filtro das listas de NFS-e (nome/CPF/CNPJ, data de emissão, valor) e a
// paginação de 5 por página — app do cliente e painel do contador.

const CAMPO =
  "w-full rounded-lg border border-line bg-sunken px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:bg-surface focus:outline-none";
const ROTULO = "mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted";

export function FiltroNotasBar({
  filtro,
  onChange,
  placeholder = "Nome ou CPF/CNPJ do tomador",
}: {
  filtro: FiltroNotas;
  onChange: (f: FiltroNotas) => void;
  placeholder?: string;
}) {
  const [mais, setMais] = useState(!!(filtro.de || filtro.ate || filtro.valorMin || filtro.valorMax));
  const set = (patch: Partial<FiltroNotas>) => onChange({ ...filtro, ...patch });
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-faint" />
          <input className={CAMPO + " pl-9"} placeholder={placeholder} value={filtro.texto} onChange={(e) => set({ texto: e.target.value })} />
        </div>
        <button
          type="button"
          onClick={() => setMais(!mais)}
          className={
            "flex shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold " +
            (mais ? "border-brand bg-brand-wash text-brand-fg" : "border-line bg-surface text-ink hover:bg-sunken")
          }
          aria-label="Filtrar por data e valor"
        >
          <SlidersHorizontal className="size-4" /> <span className="hidden sm:inline">Data e valor</span>
        </button>
        {filtroAtivo(filtro) && (
          <button
            type="button"
            onClick={() => onChange(FILTRO_VAZIO)}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-muted hover:text-ink"
            aria-label="Limpar filtros"
          >
            <X className="size-4" /> <span className="hidden sm:inline">Limpar</span>
          </button>
        )}
      </div>
      {mais && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label className={ROTULO}>Emitida de</label>
            <input type="date" className={CAMPO} value={filtro.de} onChange={(e) => set({ de: e.target.value })} />
          </div>
          <div>
            <label className={ROTULO}>até</label>
            <input type="date" className={CAMPO} value={filtro.ate} onChange={(e) => set({ ate: e.target.value })} />
          </div>
          <div>
            <label className={ROTULO}>Valor mín. (R$)</label>
            <input inputMode="decimal" className={CAMPO} placeholder="0,00" value={filtro.valorMin} onChange={(e) => set({ valorMin: e.target.value })} />
          </div>
          <div>
            <label className={ROTULO}>Valor máx. (R$)</label>
            <input inputMode="decimal" className={CAMPO} placeholder="0,00" value={filtro.valorMax} onChange={(e) => set({ valorMax: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}

export function Paginacao({
  pagina,
  totalPaginas,
  total,
  onChange,
}: {
  pagina: number;
  totalPaginas: number;
  total: number;
  onChange: (p: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted">
      <span className="tabular-nums">
        {total} nota{total === 1 ? "" : "s"}
      </span>
      {totalPaginas > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange(pagina - 1)}
            disabled={pagina <= 1}
            className="grid size-8 place-items-center rounded-lg border border-line bg-surface text-ink hover:bg-sunken disabled:opacity-30"
            aria-label="Página anterior"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="px-2 font-semibold tabular-nums text-ink">
            Página {pagina} de {totalPaginas}
          </span>
          <button
            type="button"
            onClick={() => onChange(pagina + 1)}
            disabled={pagina >= totalPaginas}
            className="grid size-8 place-items-center rounded-lg border border-line bg-surface text-ink hover:bg-sunken disabled:opacity-30"
            aria-label="Próxima página"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
