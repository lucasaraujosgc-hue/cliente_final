import type { ComponentType } from "react";
import { AlertTriangle, Clock, CircleCheck, FileText, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface StatusHeroCardProps {
  overdueCount: number;
  overdueTotal: number;
  pendingCount: number;
  pendingTotal: number;
  hasAnyGuia: boolean;
  /** Scroll the guia list into view (used by the "pending" state). */
  onSeeGuias: () => void;
}

type Tone = "danger" | "warn" | "ok" | "neutral";

const toneStyles: Record<
  Tone,
  {
    wrap: string;
    icon: string;
    cta: string;
    Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  }
> = {
  danger: {
    wrap: "border-danger/30 bg-danger-wash",
    icon: "bg-danger/15 text-danger",
    cta: "bg-ink text-ground hover:opacity-90",
    Icon: AlertTriangle,
  },
  warn: {
    wrap: "border-warn/30 bg-warn-wash",
    icon: "bg-warn/15 text-warn",
    cta: "bg-ink text-ground hover:opacity-90",
    Icon: Clock,
  },
  ok: {
    wrap: "border-brand/25 bg-brand-wash",
    icon: "bg-brand/15 text-brand-fg",
    cta: "",
    Icon: CircleCheck,
  },
  neutral: {
    wrap: "border-line bg-sunken",
    icon: "bg-surface text-faint",
    cta: "",
    Icon: FileText,
  },
};

export function StatusHeroCard({
  overdueCount,
  overdueTotal,
  pendingCount,
  pendingTotal,
  hasAnyGuia,
  onSeeGuias,
}: StatusHeroCardProps) {
  const navigate = useNavigate();

  let tone: Tone;
  let title: string;
  let detail: string;
  let action: { label: string; onClick: () => void } | null = null;

  if (overdueCount > 0) {
    tone = "danger";
    title =
      overdueCount === 1
        ? "Você tem 1 guia vencida"
        : `Você tem ${overdueCount} guias vencidas`;
    detail =
      overdueTotal > 0
        ? `${brl(overdueTotal)} em atraso. Recalcule a guia para gerar um novo PIX com multa e juros.`
        : "Recalcule a guia para gerar um novo PIX com multa e juros.";
    action = { label: "Ver guias vencidas", onClick: () => navigate("/overdue") };
  } else if (pendingCount > 0) {
    tone = "warn";
    title =
      pendingCount === 1
        ? "Você tem 1 guia a pagar"
        : `Você tem ${pendingCount} guias a pagar`;
    detail =
      pendingTotal > 0
        ? `${brl(pendingTotal)} no total. Confira os detalhes abaixo.`
        : "Confira os detalhes abaixo.";
    action = { label: "Ver guias", onClick: onSeeGuias };
  } else if (hasAnyGuia) {
    tone = "ok";
    title = "Tudo em dia \u{1F389}";
    detail = "Nenhuma guia pendente ou vencida no momento.";
  } else {
    tone = "neutral";
    title = "Nenhuma guia no momento";
    detail =
      "Quando o escritório emitir uma guia para a sua empresa, ela aparece aqui.";
  }

  const s = toneStyles[tone];
  const Icon = s.Icon;

  return (
    <section className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${s.wrap}`}>
      <div className="flex items-start gap-3.5 sm:gap-4">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-xl ${s.icon}`}
        >
          <Icon className="size-5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Situação das suas guias
          </p>
          <h2 className="mt-0.5 font-serif text-lg font-semibold leading-tight text-ink sm:text-xl">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{detail}</p>
          {action && (
            <button
              onClick={action.onClick}
              className={`mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold shadow-xs transition-opacity ${s.cta}`}
            >
              {action.label}
              <ArrowRight className="size-4" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
