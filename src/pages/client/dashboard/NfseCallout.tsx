import { FileText, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

// Prominent, full-width announcement for the upcoming NFS-e emitter.
// Clearly marked as not-yet-available — clicking only opens the info page.
export function NfseCallout() {
  const navigate = useNavigate();

  return (
    <section className="overflow-hidden rounded-2xl border border-brand/25 bg-brand-wash shadow-sm">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand-fg">
          <FileText className="size-6" strokeWidth={1.8} />
        </span>

        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-white">
            A partir de novembro/2026
          </span>
          <h2 className="mt-2 font-serif text-lg font-normal leading-tight text-ink sm:text-xl">
            Emissão de Nota de Serviço
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Em breve você emite a NFS-e da sua empresa direto pelo portal, sem
            sair daqui. A emissão ainda está em preparação e será liberada em
            <span className="font-semibold text-ink"> novembro/2026</span>.
          </p>
        </div>

        <button
          onClick={() => navigate("/nfse")}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 self-start rounded-lg bg-ink px-4 text-sm font-semibold text-ground shadow-xs transition-opacity hover:opacity-90 sm:self-center"
        >
          Saber mais
          <ArrowRight className="size-4" strokeWidth={2} />
        </button>
      </div>
    </section>
  );
}
