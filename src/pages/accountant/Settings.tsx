import { apiFetch } from "../../lib/apiClient";
import React, { useState, useEffect } from "react";
import { Settings as SettingsIcon, Save, Key, FileText, Globe, CheckCircle, AlertCircle, Upload } from "lucide-react";

export function Settings() {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    consumerKey: "",
    consumerSecret: "",
    certSenha: "",
    cnpjContratante: "",
    ambiente: "trial",
    whatsappSupport: ""
  });
  const [certFile, setCertFile] = useState<File | null>(null);
  const [hasSavedCert, setHasSavedCert] = useState(false);
  const [certMissing, setCertMissing] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const token = localStorage.getItem("accountantToken");
      const res = await apiFetch("/api/pendencies/sitfis/config", {
        
      }, "accountant");
      const data = await res.json();
      if (data.config) {
        setFormData({
          consumerKey: data.config.consumerKey || "",
          consumerSecret: data.config.consumerSecret || "",
          certSenha: data.config.certSenha || "",
          cnpjContratante: data.config.cnpjContratante || "",
          ambiente: data.config.ambiente || "trial",
          whatsappSupport: data.config.whatsappSupport || ""
        });
        setHasSavedCert(!!data.config.hasCert);
        setCertMissing(!!data.config.certMissing);
      } else {
        setHasSavedCert(false);
        setCertMissing(false);
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess("");
    setError("");

    try {
      const token = localStorage.getItem("accountantToken");
      const payload = new FormData();
      payload.append("consumerKey", formData.consumerKey);
      payload.append("consumerSecret", formData.consumerSecret);
      payload.append("certSenha", formData.certSenha);
      payload.append("cnpjContratante", formData.cnpjContratante);
      payload.append("ambiente", formData.ambiente);
      payload.append("whatsappSupport", formData.whatsappSupport);
      if (certFile) {
        payload.append("cert", certFile);
      }

      const res = await apiFetch("/api/pendencies/sitfis/config", {
        method: "POST",
        body: payload
      }, "accountant");

      if (!res.ok) {
        let errStr = "Falha ao salvar configuração";
        try {
          const data = await res.json();
          errStr = data.error || data.detail || errStr;
        } catch (err) {}
        throw new Error(errStr);
      }
      setSuccess("Configurações salvas com sucesso!");
      setCertFile(null);
      await fetchConfig();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <SettingsIcon className="w-6 h-6 text-indigo-500" />
            Configurações do Sistema
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Gerencie chaves e integrações com o Integra Contador (SERPRO).</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-6 border-b border-slate-100 dark:border-slate-800 pb-3 flex items-center gap-2">
          <Globe className="w-5 h-5 text-emerald-500" /> Integra Contador SERPRO (SitFis & DCTFWeb/DAS)
        </h2>
        
        {fetching ? (
          <div className="text-center py-10 text-slate-500">Carregando...</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Número WhatsApp (Suporte Cliente)</label>
                <input
                  type="text"
                  value={formData.whatsappSupport}
                  onChange={e => setFormData({ ...formData, whatsappSupport: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 dark:text-white"
                  placeholder="Ex: 5511999999999"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Consumer Key (OAuth2)</label>
                <input
                  type="text"
                  required
                  value={formData.consumerKey}
                  onChange={e => setFormData({ ...formData, consumerKey: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 dark:text-white"
                  placeholder="Ex: a1b2c3d4..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Consumer Secret</label>
                <input
                  type="password"
                  required
                  value={formData.consumerSecret}
                  onChange={e => setFormData({ ...formData, consumerSecret: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 dark:text-white"
                  placeholder="Ex: x9y8z7..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">CNPJ do Escritório Contratante</label>
                <input
                  type="text"
                  required
                  value={formData.cnpjContratante}
                  onChange={e => setFormData({ ...formData, cnpjContratante: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 dark:text-white"
                  placeholder="Apenas números"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Ambiente API</label>
                <select
                  value={formData.ambiente}
                  onChange={e => setFormData({ ...formData, ambiente: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 dark:text-white"
                >
                  <option value="trial">Trial (Teste)</option>
                  <option value="producao">Produção</option>
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-500" /> Autenticação mTLS (Apenas Produção)
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Certificado Digital (.pfx / .p12)</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      id="cert-upload"
                      accept=".pfx,.p12"
                      onChange={e => setCertFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                    <label htmlFor="cert-upload" className="cursor-pointer flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-xl text-sm transition-colors border border-slate-200 dark:border-slate-700 w-full md:w-auto">
                      <Upload className="w-4 h-4" /> Selecionar Arquivo
                    </label>
                    <span className="text-sm text-slate-500 truncate">
                      {certFile ? certFile.name : (certMissing ? "Arquivo nao encontrado" : (hasSavedCert ? "Certificado salvo" : "Nenhum selecionado"))}
                    </span>
                  </div>
                  {certMissing && !certFile && (
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                      O caminho do certificado esta salvo, mas o arquivo nao existe no servidor. Reenvie o .pfx/.p12.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Senha do Certificado</label>
                  <input
                    type="password"
                    value={formData.certSenha}
                    onChange={e => setFormData({ ...formData, certSenha: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 dark:text-white"
                    placeholder="Somente se houver certificado"
                  />
                </div>
              </div>
            </div>

            {success && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-sm font-bold">
                <CheckCircle className="w-4 h-4" /> {success}
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-2 text-red-700 dark:text-red-400 text-sm font-bold">
                <AlertCircle className="w-4 h-4" /> {error}
              </div>
            )}

            <div className="flex justify-end pt-4">
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50"
              >
                {loading ? "Salvando..." : <><Save className="w-4 h-4" /> Salvar Configurações</>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
