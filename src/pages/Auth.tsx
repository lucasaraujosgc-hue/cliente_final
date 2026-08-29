import React, { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { apiFetch, saveSession } from "../lib/apiClient";
import { MfaCodeForm } from "../components/MfaCodeForm";

function storeClientUser(user: unknown, remember: boolean) {
  const json = JSON.stringify(user);
  try {
    (remember ? localStorage : sessionStorage).setItem("clientUser", json);
    (remember ? sessionStorage : localStorage).removeItem("clientUser");
  } catch {
    /* private mode */
  }
}

// Shared auth-screen primitives.
const FIELD =
  "w-full rounded-lg bg-sunken border border-line px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint transition-colors focus:outline-none focus:border-brand focus:bg-surface";
const LABEL =
  "block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-1.5";
const PRIMARY_BTN =
  "w-full rounded-lg bg-brand text-white font-semibold py-3 text-[15px] shadow-sm transition-colors hover:bg-brand-strong disabled:opacity-50";

export function Login() {
  const [cnpj, setCnpj] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  const [showForgotPwd, setShowForgotPwd] = useState(false);
  const [resetStep, setResetStep] = useState(1); // 1: request, 2: reset
  const [resetCnpj, setResetCnpj] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetMsg, setResetMsg] = useState({ text: "", type: "" });
  const [isResetLoading, setIsResetLoading] = useState(false);

  // Set when an admin signs in from this form and 2FA is required.
  const [mfaChallengeId, setMfaChallengeId] = useState<string | null>(null);

  const navigate = useNavigate();

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value.replace(/\D/g, "");
    if (v.length <= 11) {
        v = v.replace(/(\d{3})(\d)/, "$1.$2");
        v = v.replace(/(\d{3})(\d)/, "$1.$2");
        v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    } else {
        v = v.replace(/^(\d{2})(\d)/, "$1.$2");
        v = v.replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3");
        v = v.replace(/\.(\d{3})(\d)/, ".$1/$2");
        v = v.replace(/(\d{4})(\d)/, "$1-$2");
    }
    setCnpj(v.substring(0, 18));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch("/api/auth/client/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj, password })
      });
      const data = await res.json();
      if (res.ok) {
        // Admin from the client form, 2FA on → go to the code step.
        if (data.mfaRequired && data.challengeId) {
          setMfaChallengeId(data.challengeId);
          return;
        }
        if (data.role === "accountant") {
           saveSession({
             kind: "accountant",
             token: data.token,
             refreshToken: data.refreshToken,
             remember: true,
           });
           navigate("/admin");
           return;
        }

        saveSession({
          kind: "client",
          token: data.token,
          refreshToken: data.refreshToken,
          remember: rememberMe,
        });
        storeClientUser(data.client, rememberMe);

        if (data.client.firstAccessDone !== true) {
           navigate("/setup-profile");
        } else {
           navigate("/dashboard");
        }
      } else {
        setError(data.error);
      }
    } catch {
      setError("Erro no servidor");
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetMsg({ text: "", type: "" });
    setIsResetLoading(true);
    try {
      const res = await apiFetch("/api/auth/client/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj: resetCnpj })
      });
      const data = await res.json();
      if (res.ok) {
        setResetStep(2);
        setResetMsg({
          text:
            data.message ||
            "Se este CNPJ estiver cadastrado com um e-mail, enviamos um código de recuperação.",
          type: "success",
        });
      } else {
        setResetMsg({
          text: data.error || "Não foi possível processar a solicitação.",
          type: "error",
        });
      }
    } catch {
      setResetMsg({ text: "Erro no servidor", type: "error" });
    }
    setIsResetLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetMsg({ text: "", type: "" });
    setIsResetLoading(true);
    try {
      const res = await apiFetch("/api/auth/client/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj: resetCnpj, code: resetCode, newPassword: resetNewPassword })
      });
      const data = await res.json();
      if (res.ok) {
        setResetMsg({ text: "Senha alterada com sucesso! Você pode fazer login.", type: "success" });
        setTimeout(() => {
          setShowForgotPwd(false);
          setResetStep(1);
          setResetCnpj("");
          setResetCode("");
          setResetNewPassword("");
          setResetMsg({ text: "", type: "" });
        }, 2500);
      } else {
        setResetMsg({ text: data.error, type: "error" });
      }
    } catch {
      setResetMsg({ text: "Erro no servidor", type: "error" });
    }
    setIsResetLoading(false);
  };

  const field = FIELD;
  const label = LABEL;
  const primaryBtn = PRIMARY_BTN;

  return (
    <div className="min-h-screen bg-ground lg:grid lg:grid-cols-[1.05fr_1fr] lg:grid-rows-1">
      {/* Brand panel — desktop only */}
      <aside className="relative hidden overflow-hidden bg-virgula-primary text-white lg:flex lg:flex-col lg:justify-between lg:p-14">
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -right-16 select-none font-serif text-[26rem] leading-none text-gold/25"
        >
          ,
        </span>
        <Logo size="lg" onDark />
        <div className="relative max-w-sm">
          <h2 className="font-serif text-4xl font-normal leading-[1.15] text-balance">
            Suas guias, vencimentos e documentos — num lugar só.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            O que você deve, quando vence, e se a empresa está regular. Sem
            planilha, sem e-mail perdido.
          </p>
        </div>
        <p className="relative text-xs text-white/45">Vírgula Contábil · Portal do Cliente</p>
      </aside>

      {/* Form */}
      <div className="flex min-h-screen flex-col justify-center px-6 py-12 sm:px-10 lg:min-h-0">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-9 lg:hidden">
            <Logo size="md" />
          </div>

          <h1 className="font-serif text-2xl font-normal text-ink">
            {mfaChallengeId ? "Verificação em duas etapas" : "Entrar no portal"}
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {mfaChallengeId
              ? "Digite o código enviado ao e-mail do contador."
              : "Acesse com o CNPJ da sua empresa."}
          </p>

          {error && (
            <div className="mt-6 rounded-lg border border-danger/25 bg-danger-wash px-3.5 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          {mfaChallengeId ? (
            <div className="mt-7">
              <MfaCodeForm
                challengeId={mfaChallengeId}
                onVerified={() => navigate("/admin")}
                onCancel={() => setMfaChallengeId(null)}
              />
            </div>
          ) : (
            <form onSubmit={handleLogin} className="mt-7 space-y-5">
              <div>
                <label className={label}>CPF ou CNPJ</label>
                <input
                  type="text"
                  className={field}
                  placeholder="00.000.000/0001-00"
                  value={cnpj}
                  onChange={handleCnpjChange}
                  autoComplete="username"
                  required
                />
              </div>
              <div>
                <label className={label}>Senha</label>
                <input
                  type="password"
                  className={field}
                  placeholder="Sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <label className="flex items-center gap-2 text-sm text-muted select-none">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-line text-brand focus:ring-brand/40"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  Permanecer conectado
                </label>
                <button
                  type="button"
                  onClick={() => setShowForgotPwd(true)}
                  className="text-sm font-medium text-brand hover:text-brand-strong"
                >
                  Esqueci a senha
                </button>
              </div>

              <button type="submit" className={primaryBtn}>
                Acessar
              </button>
            </form>
          )}

          <div className="mt-10 border-t border-line pt-5 text-center">
            <button
              type="button"
              onClick={() => navigate("/admin/login")}
              className="text-xs font-medium text-faint hover:text-muted"
            >
              Acesso para contadores
            </button>
          </div>
        </div>
      </div>

      {showForgotPwd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl border border-line bg-surface p-7 shadow-lg">
            <button
              onClick={() => { setShowForgotPwd(false); setResetStep(1); setResetMsg({ text: "", type: "" }); }}
              className="absolute right-4 top-4 text-faint transition-colors hover:text-muted"
              aria-label="Fechar"
            >
              ✕
            </button>
            <h2 className="font-serif text-xl font-normal text-ink">Recuperar senha</h2>
            <p className="mt-1.5 text-sm text-muted">
              {resetStep === 1
                ? "Informe seu CNPJ para receber um código por e-mail."
                : "Informe o código recebido e a nova senha."}
            </p>

            {resetMsg.text && (
              <div
                className={`mt-5 rounded-lg border px-3.5 py-3 text-sm ${
                  resetMsg.type === "success"
                    ? "border-ok/25 bg-ok-wash text-brand-fg"
                    : "border-danger/25 bg-danger-wash text-danger"
                }`}
              >
                {resetMsg.text}
              </div>
            )}

            {resetStep === 1 ? (
              <form onSubmit={handleForgotPassword} className="mt-5 space-y-4">
                <div>
                  <label className={label}>CNPJ</label>
                  <input
                    type="text"
                    className={field}
                    placeholder="00.000.000/0001-00"
                    value={resetCnpj}
                    onChange={(e) => {
                      let v = e.target.value.replace(/\D/g, "");
                      if (v.length > 11) {
                        v = v.replace(/^(\d{2})(\d)/, "$1.$2");
                        v = v.replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3");
                        v = v.replace(/\.(\d{3})(\d)/, ".$1/$2");
                        v = v.replace(/(\d{4})(\d)/, "$1-$2");
                      }
                      setResetCnpj(v.substring(0, 18));
                    }}
                    required
                  />
                </div>
                <button type="submit" disabled={isResetLoading} className={primaryBtn}>
                  {isResetLoading ? "Enviando..." : "Enviar código"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetPassword} className="mt-5 space-y-4">
                <div>
                  <label className={label}>Código de verificação</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className={`${field} text-center font-mono text-lg tracking-[0.4em]`}
                    placeholder="000000"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                  />
                </div>
                <div>
                  <label className={label}>Nova senha</label>
                  <input
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    className={field}
                    placeholder="Mínimo de 8 caracteres"
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" disabled={isResetLoading} className={primaryBtn}>
                  {isResetLoading ? "Salvando..." : "Redefinir senha"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AccountantLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [mfaChallengeId, setMfaChallengeId] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await apiFetch("/api/auth/accountant/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
        if (data.mfaRequired && data.challengeId) {
          setMfaChallengeId(data.challengeId);
          return;
        }
        if (data.token && data.refreshToken) {
          saveSession({
            kind: "accountant",
            token: data.token,
            refreshToken: data.refreshToken,
            remember: true,
          });
          navigate("/admin");
        }
      } else {
        setError(data.error);
      }
    } catch {
      setError("Erro no servidor");
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-ground px-6 py-12 sm:px-10">
      <div className="mx-auto w-full max-w-sm">
        <Logo size="md" />

        <p className="mt-9 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
          Painel administrativo
        </p>
        <h1 className="mt-1.5 font-serif text-2xl font-normal text-ink">
          {mfaChallengeId ? "Verificação em duas etapas" : "Área do contador"}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {mfaChallengeId
            ? "Digite o código enviado ao seu e-mail."
            : "Acesse com suas credenciais administrativas."}
        </p>

        {error && (
          <div className="mt-6 rounded-lg border border-danger/25 bg-danger-wash px-3.5 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {mfaChallengeId ? (
          <div className="mt-7">
            <MfaCodeForm
              challengeId={mfaChallengeId}
              onVerified={() => navigate("/admin")}
              onCancel={() => setMfaChallengeId(null)}
            />
          </div>
        ) : (
          <form onSubmit={handleLogin} className="mt-7 space-y-5">
            <div>
              <label className={LABEL}>Usuário</label>
              <input
                type="text"
                className={FIELD}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className={LABEL}>Senha</label>
              <input
                type="password"
                className={FIELD}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" className={PRIMARY_BTN}>
              Entrar
            </button>
          </form>
        )}

        <div className="mt-10 border-t border-line pt-5 text-center">
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="text-xs font-medium text-faint hover:text-muted"
          >
            Voltar para a área do cliente
          </button>
        </div>
      </div>
    </div>
  );
}
