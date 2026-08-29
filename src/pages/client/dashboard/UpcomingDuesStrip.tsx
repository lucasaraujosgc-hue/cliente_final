import { ChevronRight } from "lucide-react";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function fmtDate(d?: string | null) {
  if (!d) return "—";
  if (d.includes("-")) {
    const [y, m, day] = d.split("T")[0].split("-");
    return `${day}/${m}/${y}`;
  }
  return d;
}

export interface UpcomingDue {
  id: string;
  title: string;
  competence?: string | null;
  dueDate?: string | null;
  value?: number | null;
  isOverdue: boolean;
  isSoon: boolean;
}

interface UpcomingDuesStripProps {
  items: UpcomingDue[];
  /** Jump the dashboard to a given competence and scroll to the guia list. */
  onPick: (competence: string | null | undefined) => void;
}

// Compact chronological view of the next unpaid guias across every competence —
// complements the competence-scoped list further down the page.
export function UpcomingDuesStrip({ items, onPick }: UpcomingDuesStripProps) {
  if (items.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <header className="border-b border-line px-5 py-3.5">
        <h2 className="font-serif text-base font-normal text-ink">
          Próximos vencimentos
        </h2>
        <p className="mt-0.5 text-xs text-muted">
          Todas as competências, em ordem de data.
        </p>
      </header>
      <ul className="divide-y divide-line">
        {items.map((it) => {
          const dot = it.isOverdue
            ? "bg-danger"
            : it.isSoon
              ? "bg-warn"
              : "bg-faint";
          const statusText = it.isOverdue
            ? "vencida"
            : it.isSoon
              ? "vence em breve"
              : "a pagar";
          return (
            <li key={it.id}>
              <button
                onClick={() => onPick(it.competence)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-sunken"
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${dot}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {it.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted tabular-nums">
                    {fmtDate(it.dueDate)} · {statusText}
                    {it.competence ? ` · comp. ${it.competence}` : ""}
                  </span>
                </span>
                {typeof it.value === "number" && it.value > 0 && (
                  <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">
                    {brl(it.value)}
                  </span>
                )}
                <ChevronRight
                  className="size-4 shrink-0 text-faint"
                  strokeWidth={1.9}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
