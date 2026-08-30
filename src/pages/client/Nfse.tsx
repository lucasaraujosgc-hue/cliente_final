import { useEffect, useState } from "react";
import { FileText, CalendarClock } from "lucide-react";
import { getNfseStatus, listEmissoes, NfseEmissao, NfseStatus } from "../../lib/nfse";

export function ClientNfse() {
  const [status, setStatus] = useState<NfseStatus | null>(null);
  const [emissoes, setEmissoes] = useState<NfseEmissao[]>([]);

  useEffect(() => {
    getNfseStatus().then(setStatus).catch(() => {});
    listEmissoes().then(setEmissoes).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[1.75rem] font-normal leading-tight text-ink">
          Emissão de Nota de Serviço
        </h1>
        <p className="mt-1 text-sm text-muted">
          Emita a NFS-e da sua empresa direto pelo portal.
        </p>
      </header>

      <div className="flex items-start gap-3.5 rounded-2xl border border-warn/25 bg-warn-wash p-5 shadow-sm">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-warn/15 text-warn">
          <CalendarClock className="size-5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Em preparação
          </p>
          <h2 className="mt-0.5 font-serif text-lg font-normal leading-tight text-ink">
            Disponível a partir de novembro/2026
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {status?.message ||
              "Estamos finalizando a integração com a prefeitura. Assim que liberar, você emite a nota por aqui."}
          </p>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <header className="border-b border-line px-5 py-4">
          <h2 className="font-serif text-base font-normal text-ink">Notas emitidas</h2>
        </header>
        {emissoes.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <FileText className="mx-auto size-8 text-faint" strokeWidth={1.6} />
            <p className="mt-3 text-sm font-semibold text-ink">Nenhuma nota ainda</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
              As notas de serviço que você emitir aparecem aqui.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {emissoes.map((e) => (
              <li key={e.id} className="px-5 py-4 text-sm">
                <span className="font-semibold text-ink">
                  {e.numeroNota ? `Nota ${e.numeroNota}` : "Rascunho"}
                </span>
                <span className="ml-2 text-xs text-muted">{e.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
