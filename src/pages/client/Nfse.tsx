import { useEffect, useState } from "react";
import {
  FileText,
  CalendarClock,
  Plus,
  Share2,
  Copy,
  Eye,
  Loader2,
  Ban,
} from "lucide-react";
import {
  getNfseStatus,
  getNfseAtividades,
  listEmissoes,
  getEmissao,
  viewDanfse,
  shareDanfse,
  cancelarNfse,
  centavosToBRL,
  nfseStatusLabel,
  type NfseStatus,
  type NfseEmissao,
  type NfseAtividadeCliente,
} from "../../lib/nfse";
import { formatCnpj } from "../../lib/cnpj";
import { EmitWizard, type WizardPrefill } from "./nfse/EmitWizard";

export function ClientNfse() {
  const [status, setStatus] = useState<NfseStatus | null>(null);
  const [emissoes, setEmissoes] = useState<NfseEmissao[]>([]);
  const [atividades, setAtividades] = useState<NfseAtividadeCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState<{ open: boolean; prefill: WizardPrefill | null }>({
    open: false,
    prefill: null,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState("");

  const load = async () => {
    const s = await getNfseStatus().catch(() => null);
    setStatus(s);
    if (s?.enabled) {
      const [e, a] = await Promise.all([
        listEmissoes().catch(() => []),
        getNfseAtividades().catch(() => []),
      ]);
      setEmissoes(e);
      setAtividades(a);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const duplicar = async (id: string) => {
    setBusyId(id);
    try {
      const d = await getEmissao(id);
      setWizard({
        open: true,
        prefill: {
          tomador: {
            doc: d.tomadorDoc || "",
            nome: d.tomadorNome || "",
            email: d.tomadorEmail,
            telefone: d.tomadorTelefone,
            endereco: d.tomadorEndereco,
          },
          atividadeId: d.atividadeId,
          descricao: d.descricao || "",
          valor: d.valorServicos,
        },
      });
    } finally {
      setBusyId(null);
    }
  };

  const doShare = async (e: NfseEmissao) => {
    setBusyId(e.id);
    try {
      const r = await shareDanfse(e.id, e.numeroNota);
      setFlash(r === "downloaded" ? "PDF baixado." : "");
    } catch {
      setFlash("Não foi possível gerar o PDF.");
    } finally {
      setBusyId(null);
      setTimeout(() => setFlash(""), 3000);
    }
  };

  const doView = async (e: NfseEmissao) => {
    setBusyId(e.id);
    try {
      await viewDanfse(e.id, e.numeroNota);
    } catch {
      setFlash("Não foi possível abrir o PDF.");
      setTimeout(() => setFlash(""), 3000);
    } finally {
      setBusyId(null);
    }
  };

  const doCancel = async (e: NfseEmissao) => {
    const motivo = window.prompt("Descreva o motivo do cancelamento (mín. 15 caracteres):");
    if (!motivo || motivo.trim().length < 15) return;
    setBusyId(e.id);
    try {
      const r = await cancelarNfse(e.id, motivo.trim());
      setFlash(r.ok ? "Nota cancelada." : r.error || "Falha ao cancelar.");
      await load();
    } finally {
      setBusyId(null);
      setTimeout(() => setFlash(""), 3000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-muted">
        <Loader2 className="size-5 animate-spin" /> Carregando…
      </div>
    );
  }

  // -------- not enabled: keep the "novembro/2026" card --------
  if (!status?.enabled) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-serif text-[1.75rem] font-semibold leading-tight text-ink">
            Emissão de Nota de Serviço
          </h1>
          <p className="mt-1 text-sm text-muted">Emita a NFS-e da sua empresa direto pelo portal.</p>
        </header>

        <div className="flex items-start gap-3.5 rounded-2xl border border-warn/25 bg-warn-wash p-5 shadow-sm">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-warn/15 text-warn">
            <CalendarClock className="size-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Em preparação</p>
            <h2 className="mt-0.5 font-serif text-lg font-semibold leading-tight text-ink">
              Disponível a partir de novembro/2026
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {status?.message ||
                "Estamos finalizando a integração com a prefeitura. Assim que liberar, você emite a nota por aqui."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // -------- enabled --------
  if (wizard.open) {
    return (
      <EmitWizard
        atividades={atividades}
        prefill={wizard.prefill}
        onClose={() => {
          setWizard({ open: false, prefill: null });
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[1.75rem] font-semibold leading-tight text-ink">
            Emissão de Nota de Serviço
          </h1>
          <p className="mt-1 text-sm text-muted">Emita a NFS-e da sua empresa direto pelo portal.</p>
        </div>
        <button
          onClick={() => setWizard({ open: true, prefill: null })}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-strong"
        >
          <Plus className="size-4" /> Emitir nova nota
        </button>
      </header>

      {flash && (
        <p className="rounded-lg border border-line bg-sunken px-4 py-2.5 text-sm text-muted">{flash}</p>
      )}

      <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <header className="border-b border-line px-5 py-4">
          <h2 className="font-serif text-base font-semibold text-ink">Notas emitidas</h2>
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
            {emissoes.map((e) => {
              const s = nfseStatusLabel(e.status);
              const canPdf = e.status === "emitida" || e.status === "cancelada";
              return (
                <li key={e.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {e.tomadorNome || (e.tomadorDoc ? formatCnpj(e.tomadorDoc) : "—")}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {new Date(e.dataEmissao || e.createdAt).toLocaleDateString("pt-BR")}
                        {e.numeroNota ? ` · nº ${e.numeroNota}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink tabular-nums">
                        {centavosToBRL(e.valorServicos)}
                      </span>
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-[11px] font-bold " +
                          (s.tone === "ok"
                            ? "bg-ok-wash text-brand-fg"
                            : s.tone === "danger"
                              ? "bg-danger-wash text-danger"
                              : s.tone === "warn"
                                ? "bg-warn-wash text-warn"
                                : "bg-sunken text-muted")
                        }
                      >
                        {s.label}
                      </span>
                    </div>
                  </div>

                  {e.status === "rejeitada" && e.rejeicaoMotivo && (
                    <p className="mt-2 text-xs text-danger">{e.rejeicaoMotivo}</p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {canPdf && (
                      <>
                        <button
                          disabled={busyId === e.id}
                          onClick={() => doView(e)}
                          className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-sunken disabled:opacity-50"
                        >
                          <Eye className="size-3.5" /> Ver PDF
                        </button>
                        <button
                          disabled={busyId === e.id}
                          onClick={() => doShare(e)}
                          className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-sunken disabled:opacity-50"
                        >
                          <Share2 className="size-3.5" /> Compartilhar
                        </button>
                      </>
                    )}
                    <button
                      disabled={busyId === e.id}
                      onClick={() => duplicar(e.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-sunken disabled:opacity-50"
                    >
                      <Copy className="size-3.5" /> Duplicar
                    </button>
                    {e.status === "emitida" && (
                      <button
                        disabled={busyId === e.id}
                        onClick={() => doCancel(e)}
                        className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger-wash disabled:opacity-50"
                      >
                        <Ban className="size-3.5" /> Cancelar
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
