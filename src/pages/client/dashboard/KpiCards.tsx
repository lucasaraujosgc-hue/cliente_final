import type { ComponentType, ReactNode } from "react";
import { Activity, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface KpiCardsProps {
  selectedCompetence: string;
  monthsTotalBilling: number;
  pendingDocsCount: number;
  totalPendingValue: number;
  overdueDocsCount: number;
  totalOverdueValue: number;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Tile({
  label,
  value,
  sub,
  Icon,
  tone = "neutral",
  onClick,
  ariaLabel,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  tone?: "neutral" | "ok" | "warn" | "danger";
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const iconTone =
    tone === "danger"
      ? "bg-danger-wash text-danger"
      : tone === "warn"
        ? "bg-warn-wash text-warn"
        : tone === "ok"
          ? "bg-brand-wash text-brand-fg"
          : "bg-sunken text-faint";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={ariaLabel}
      className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface p-4 text-left shadow-xs transition-shadow enabled:hover:shadow-sm disabled:cursor-default"
    >
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-faint">{label}</p>
        <p className="mt-1.5 font-serif text-[1.35rem] leading-none text-ink tabular-nums">{value}</p>
        {sub && <p className="mt-2 text-[11px] text-muted tabular-nums">{sub}</p>}
      </div>
      <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${iconTone}`}>
        <Icon className="size-[18px]" strokeWidth={1.9} />
      </span>
    </button>
  );
}

export function KpiCards({
  selectedCompetence,
  monthsTotalBilling,
  pendingDocsCount,
  totalPendingValue,
  overdueDocsCount,
  totalOverdueValue,
}: KpiCardsProps) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Tile
        label={`Faturamento ${selectedCompetence}`}
        value={brl(monthsTotalBilling)}
        sub="Declarado — contabilidade + manual"
        Icon={Activity}
        tone="ok"
      />
      <Tile
        label={`Guias de ${selectedCompetence}`}
        value={`${pendingDocsCount} ${pendingDocsCount === 1 ? "pendência" : "pendências"}`}
        sub={
          pendingDocsCount > 0
            ? `A pagar: ${brl(totalPendingValue)}`
            : "Tudo pago e em dia"
        }
        Icon={pendingDocsCount > 0 ? Clock : CheckCircle2}
        tone={pendingDocsCount > 0 ? "warn" : "ok"}
      />
      <Tile
        label="Guias em atraso"
        value={overdueDocsCount > 0 ? `${overdueDocsCount} atrasada${overdueDocsCount === 1 ? "" : "s"}` : "Nenhuma"}
        sub={overdueDocsCount > 0 ? `Total: ${brl(totalOverdueValue)}` : "Empresa regular"}
        Icon={overdueDocsCount > 0 ? AlertTriangle : CheckCircle2}
        tone={overdueDocsCount > 0 ? "danger" : "ok"}
        onClick={() => navigate("/overdue")}
        ariaLabel="Ver guias em atraso"
      />
    </div>
  );
}
