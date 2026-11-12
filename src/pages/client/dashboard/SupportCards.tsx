import { MessageCircle, ArrowUpRight, Wallet } from "lucide-react";

interface SupportCardsProps {
  whatsappSupport: string;
}

export function SupportCards({ whatsappSupport }: SupportCardsProps) {
  const wa = whatsappSupport.replace(/\D/g, "");
  return (
    <div className="space-y-3">
      {wa && (
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noreferrer"
          className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-xs transition-shadow hover:shadow-sm"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-wash text-brand-fg">
            <MessageCircle className="size-[18px]" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-sm font-semibold text-ink">
              Falar com a contabilidade
              <ArrowUpRight className="size-3.5 text-faint transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Dúvidas no faturamento ou na conciliação do extrato — chat direto.
            </p>
          </div>
        </a>
      )}

      <a
        href="https://financeiro.virgulacontabil.com.br"
        target="_blank"
        rel="noreferrer"
        className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-xs transition-shadow hover:shadow-sm"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken text-faint">
          <Wallet className="size-[18px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-sm font-semibold text-ink">
            Gestão financeira
            <ArrowUpRight className="size-3.5 text-faint transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Fluxo de caixa, boletos e controle da empresa num sistema à parte.
          </p>
        </div>
      </a>
    </div>
  );
}
