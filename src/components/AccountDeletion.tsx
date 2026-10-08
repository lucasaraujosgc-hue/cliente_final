import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  getDeletionState,
  requestDeletion,
  cancelDeletion,
  type DeletionState,
} from "../lib/account";

// "Zona de risco" do modal Minha conta. Fica dentro do app de propósito: a
// Apple reprova exclusão que só existe por e-mail/suporte (5.1.1(v)).
export function AccountDeletion() {
  const [state, setState] = useState<DeletionState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    getDeletionState()
      .then(setState)
      .catch(() => setState({ requested: false, requestedAt: null, reason: null }));
  }, []);

  const pedir = async () => {
    setBusy(true);
    setErro("");
    const r = await requestDeletion(reason);
    if (r.ok) {
      setState({ requested: true, requestedAt: r.requestedAt ?? null, reason: reason || null });
      setConfirming(false);
      setReason("");
    } else {
      setErro(r.error || "Não foi possível registrar o pedido.");
    }
    setBusy(false);
  };

  const cancelar = async () => {
    setBusy(true);
    setErro("");
    const r = await cancelDeletion();
    if (r.ok) setState({ requested: false, requestedAt: null, reason: null });
    else setErro(r.error || "Não foi possível cancelar.");
    setBusy(false);
  };

  if (!state) return null;

  // --- pedido já registrado --------------------------------------------
  if (state.requested) {
    return (
      <div className="mt-6 rounded-xl border border-warn/30 bg-warn-wash p-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Exclusão solicitada</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Pedido registrado
              {state.requestedAt
                ? ` em ${format(parseISO(state.requestedAt), "dd/MM/yyyy", { locale: ptBR })}`
                : ""}
              . O escritório foi avisado e vai encerrar as obrigações fiscais pendentes antes de
              apagar a conta. Enquanto isso você continua com acesso normal.
            </p>
            {erro && <p className="mt-2 text-xs font-medium text-danger">{erro}</p>}
            <button
              onClick={cancelar}
              disabled={busy}
              className="mt-3 text-xs font-semibold text-brand-fg underline underline-offset-2 hover:text-brand-strong disabled:opacity-50"
            >
              {busy ? "Cancelando…" : "Cancelar o pedido"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- confirmação ------------------------------------------------------
  if (confirming) {
    return (
      <div className="mt-6 rounded-xl border border-danger/30 bg-danger-wash p-4">
        <p className="text-sm font-semibold text-ink">Excluir minha conta</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          Seu acesso ao portal será encerrado e seus dados pessoais apagados. Guias, notas e
          documentos fiscais precisam ser guardados pelo prazo legal (5 anos) — por isso a
          exclusão é feita pelo escritório depois de encerrar as obrigações do período, e não
          na hora.
        </p>
        <label className="mt-3 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Motivo (opcional)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 1000))}
          rows={2}
          placeholder="Ex.: encerrei a empresa"
          className="mt-1 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-danger focus:outline-none"
        />
        {erro && <p className="mt-2 text-xs font-medium text-danger">{erro}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={pedir}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3.5 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Confirmar pedido de exclusão
          </button>
          <button
            onClick={() => {
              setConfirming(false);
              setErro("");
            }}
            disabled={busy}
            className="rounded-lg border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-muted hover:text-ink disabled:opacity-50"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  // --- estado inicial ---------------------------------------------------
  return (
    <div className="mt-6 border-t border-line pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
        Zona de risco
      </p>
      <button
        onClick={() => setConfirming(true)}
        className="mt-2 text-sm font-semibold text-danger hover:underline"
      >
        Excluir minha conta
      </button>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Encerra seu acesso ao portal e apaga seus dados pessoais.
      </p>
    </div>
  );
}
