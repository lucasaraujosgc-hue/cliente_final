import { apiFetch } from "../../lib/apiClient";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calculator } from "lucide-react";

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
    const token = localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");
    
    try {
      const res = await apiFetch("/api/client/setup-profile", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ email, password })
      });
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

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-slate-900 flex flex-col items-center justify-center relative overflow-hidden transition-colors">
      <div className="absolute inset-0 bg-gradient-to-br from-virgula-green/10 via-white dark:via-slate-900 to-slate-100/50 dark:to-slate-800/50 -z-0"></div>
      
      <div className="w-full max-w-lg bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-slate-900/50 border border-white dark:border-slate-700 p-8 z-10 mx-4">
        <div className="text-center mb-8 flex flex-col items-center">
          <div className="flex items-center space-x-3 mb-6">
            <div className="w-12 h-12 bg-virgula-card rounded-xl border border-white/10 flex items-center justify-center text-virgula-green shadow-[0_0_20px_rgba(16,185,129,0.25)]">
               <Calculator strokeWidth={2.5} className="w-[30px] h-[30px]" />
            </div>
            <div className="flex flex-col justify-center text-left">
                <span className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight leading-none mb-0.5">Vírgula</span>
                <span className="text-base font-semibold text-virgula-green tracking-widest leading-none uppercase">Contábil</span>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Bem-vindo(a)!</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Para garantir sua segurança, por favor cadastre seu e-mail e atualize sua senha de acesso inicial.</p>
        </div>

        {error && (
            <div className="mb-6 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm rounded-lg border border-red-100 dark:border-red-800">
              {error}
            </div>
        )}

        <form onSubmit={handleSetup} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">E-mail de Trabalho</label>
            <input
              type="email"
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700/50 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-virgula-green text-sm"
              placeholder="exemplo@suaempresa.com.br"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Nova Senha (Opcional)</label>
            <input
              type="password"
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 bg-white/50 dark:bg-slate-700/50 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-virgula-green text-sm"
              placeholder="Sua senha ou deixe em branco para manter"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          <div className="flex items-start bg-slate-50 dark:bg-slate-700/30 p-3 rounded-xl border border-slate-200 dark:border-slate-600">
            <input 
              id="terms" 
              type="checkbox" 
              required
              checked={acceptedTerms}
              onChange={e => setAcceptedTerms(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-virgula-green border-slate-300 rounded focus:ring-virgula-green"
            />
            <label htmlFor="terms" className="ml-2 block text-xs text-slate-600 dark:text-slate-400">
              Eu li e concordo com os <a href="#" className="text-virgula-green hover:underline font-semibold" onClick={(e) => { e.preventDefault(); alert("1. O uso da plataforma é de responsabilidade do cliente.\n2. Os dados trafegados são armazenados com segurança.\n3. O portal não substitui a orientação do seu contador.") }}>Termos de Uso</a> e Política de Privacidade do portal.
            </label>
          </div>

          <button
            type="submit"
            className="w-full bg-virgula-green text-white font-bold py-3 rounded-lg hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-900/30"
          >
            Confirmar e Acessar Portal
          </button>
        </form>
      </div>
    </div>
  );
}
