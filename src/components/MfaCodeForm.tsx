import React, { useState } from "react";
import { apiFetch, saveSession } from "../lib/apiClient";

// Second step of the accountant login: enter the 6-digit code emailed after
// username + password were accepted. On success it stores the session and calls
// onVerified() (the caller navigates). Token-styled so it works on both the
// client and the accountant login screens.
export function MfaCodeForm({
  challengeId: initialChallengeId,
  onVerified,
  onCancel,
}: {
  challengeId: string;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const [challengeId, setChallengeId] = useState(initialChallengeId);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("Enviamos um código de acesso para o e-mail do contador.");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/accountant/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token && data.refreshToken) {
        saveSession({
          kind: "accountant",
          token: data.token,
          refreshToken: data.refreshToken,
          remember: true,
        });
        onVerified();
        return;
      }
      setError(data.error || "Código inválido ou expirado.");
    } catch {
      setError("Erro de conexão com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError("");
    setResending(true);
    try {
      const res = await apiFetch("/api/auth/accountant/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.challengeId) {
        setChallengeId(data.challengeId);
        setInfo("Se o código anterior expirou, um novo foi enviado.");
      } else {
        setError(data.error || "Não foi possível reenviar o código.");
      }
    } catch {
      setError("Erro de conexão com o servidor.");
    } finally {
      setResending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted">{info}</p>
      {error && (
        <div className="rounded-lg border border-danger/25 bg-danger-wash px-3.5 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-1.5">
          Código de verificação
        </label>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="w-full rounded-lg bg-sunken border border-line px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-ink transition-colors focus:outline-none focus:border-brand focus:bg-surface"
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          required
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong disabled:opacity-50"
      >
        {loading ? "Verificando..." : "Confirmar e entrar"}
      </button>
      <div className="flex items-center justify-between text-xs">
        <button type="button" onClick={onCancel} className="font-medium text-faint hover:text-muted">
          Voltar
        </button>
        <button
          type="button"
          onClick={resend}
          disabled={resending}
          className="font-medium text-brand hover:text-brand-strong disabled:opacity-50"
        >
          {resending ? "Reenviando..." : "Reenviar código"}
        </button>
      </div>
    </form>
  );
}
