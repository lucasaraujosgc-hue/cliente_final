import { apiFetch } from "../../lib/apiClient";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../../components/Logo";

const FIELD =
  "w-full rounded-lg bg-sunken border border-line px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint transition-colors focus:outline-none focus:border-brand focus:bg-surface";
const LABEL = "block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-1.5";
const PRIMARY_BTN =
  "w-full rounded-lg bg-brand text-white font-semibold py-3 text-[15px] shadow-sm transition-colors hover:bg-brand-strong disabled:opacity-50";

export function SetupProfile() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const navigate = useNavigate();

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedTerms) {
      setError("Você deve aceitar os termos de uso para continuar.");
      return;
    }
    if (password && password.length < 8) {
      setError("A nova senha precisa ter ao menos 8 caracteres (ou deixe em branco).");
      return;
    }
    try {
      const res = await apiFetch("/api/client/setup-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      }, "client");
      const data = await res.json();
      if (res.ok) {
        navigate("/dashboard");
      } else {
        setError(data.error);
      }
    } catch {
      setError("Erro no servidor");
    }
  };

  const field = FIELD;
  const label = LABEL;

  return (
    <div className="flex min-h-screen flex-col justify-center bg-ground px-6 py-12 sm:px-10">
      <div className="mx-auto w-full max-w-md">
        <Logo size="md" />

        <p className="mt-9 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
          Primeiro acesso
        </p>
        <h1 className="mt-1.5 font-serif text-2xl font-normal text-ink">Bem-vindo(a) ao portal</h1>
        <p className="mt-1.5 text-sm text-muted">
          Cadastre um e-mail de contato e troque a senha inicial (o CNPJ) por uma sua.
        </p>

        {error && (
          <div className="mt-6 rounded-lg border border-danger/25 bg-danger-wash px-3.5 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <form onSubmit={handleSetup} className="mt-7 space-y-5">
          <div>
            <label className={label}>E-mail de contato</label>
            <input
              type="email"
              className={field}
              placeholder="exemplo@suaempresa.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label className={label}>Nova senha (opcional)</label>
            <input
              type="password"
              minLength={8}
              autoComplete="new-password"
              className={field}
              placeholder="Mínimo de 8 caracteres — ou deixe em branco"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-line bg-sunken px-3.5 py-3 text-xs text-muted select-none">
            <input
              type="checkbox"
              required
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 rounded border-line text-brand focus:ring-brand/40"
            />
            <span>
              Li e concordo com os{" "}
              <button
                type="button"
                className="font-semibold text-brand hover:underline"
                onClick={() =>
                  alert(
                    "1. O uso da plataforma é de responsabilidade do cliente.\n2. Os dados trafegados são armazenados com segurança.\n3. O portal não substitui a orientação do seu contador.",
                  )
                }
              >
                Termos de Uso
              </button>{" "}
              e a Política de Privacidade.
            </span>
          </label>

          <button type="submit" className={PRIMARY_BTN}>
            Confirmar e acessar
          </button>
        </form>
      </div>
    </div>
  );
}
