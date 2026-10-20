import { Smartphone, X } from "lucide-react";

interface PwaBannerProps {
  onDismiss: () => void;
}

export function PwaBanner({ onDismiss }: PwaBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-sunken px-4 py-3.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-wash text-brand-fg">
        <Smartphone className="size-4" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">Instale o portal como app</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          <span className="font-medium text-ink">iOS:</span> pelo Safari, toque em
          Compartilhar → “Adicionar à Tela de Início”.{" "}
          <span className="font-medium text-ink">Android:</span> menu do Chrome →
          “Instalar aplicativo”.
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="-mr-1 -mt-0.5 shrink-0 p-1.5 text-faint transition-colors hover:text-muted"
        title="Dispensar"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
