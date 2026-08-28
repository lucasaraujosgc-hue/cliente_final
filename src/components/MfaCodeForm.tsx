import React, { useState } from "react";
import { apiFetch, saveSession } from "../lib/apiClient";

// Second step of the accountant login: enter the 6-digit code emailed after
// username + password were accepted. On success it stores the session and calls
// onVerified() (the caller navigates).
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
      <p className="text-sm text-slate-500 dark:text-slate-400">{info}</p>
      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 text-red-200 text-sm rounded-lg">
          {error}
        </div>
      )}
      <div>
        <label className="block text-sm font-semibold text-slate-300 mb-1">Código de Verificação</label>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="w-full px-4 py-2 border border-slate-700 bg-slate-800/50 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-lg tracking-widest font-mono"
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          required
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white font-bold py-2.5 rounded-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/50 disabled:opacity-50"
      >
        {loading ? "Verificando..." : "Confirmar e Entrar"}
      </button>
      <div className="flex items-center justify-between text-xs">
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-200">
          Voltar
        </button>
        <button
          type="button"
          onClick={resend}
          disabled={resending}
          className="text-slate-400 hover:text-slate-200 disabled:opacity-50"
        >
          {resending ? "Reenviando..." : "Reenviar código"}
        </button>
      </div>
    </form>
  );
}
