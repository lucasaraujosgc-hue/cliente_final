import React, { useState } from "react";
import { RefreshCw, FileText, Send, Copy, Check, Download, AlertCircle } from "lucide-react";

interface Guia {
  id: string; // O ID do documento
  tipoGuia: string;
  competencia: string; // 'MM/YYYY' ou convertido
  dataVencimento?: string;
  valor?: number;
  status: string;
  title?: string;
  pixCode?: string;
}

interface Props {
  clienteId: string;
  guia: Guia;
  onAtualizado: (novaGuia: any) => void;
  isOverdue: boolean;
}

export function GuiaAtualizarButton({ clienteId, guia, onAtualizado, isOverdue }: Props) {
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizada, setAtualizada] = useState(false);
  const [mensagemEnviada, setMensagemEnviada] = useState(false);
  const [novaDataVencimento, setNovaDataVencimento] = useState("");
  const [novoValor, setNovoValor] = useState<number | null>(null);
  const [pdfPath, setPdfPath] = useState("");
  const [pixCode, setPixCode] = useState("");
  const [copied, setCopied] = useState(false);

  const isSupported = guia.tipoGuia === "DCTFWEB_INSS" || guia.tipoGuia === "DAS_SIMPLES";
  const tipoLabel = guia.tipoGuia === "DCTFWEB_INSS" ? "INSS" : (guia.tipoGuia === "DAS_SIMPLES" ? "DAS Simples" : (guia.title || "Guia"));

  async function handleAtualizar() {
    setLoading(true);
    setErro(null);
    try {
      const token = localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");
      
      if (isSupported) {
        const parts = (guia.competencia || "").split("/");
        const compStr = parts.length === 2 ? `${parts[1]}${parts[0]}` : "202605";

        const res = await fetch(`/api/pendencies/guia/${clienteId}`, {
          method: "POST",
          headers: { 
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}` 
          },
          body: JSON.stringify({ tipoGuia: guia.tipoGuia, competencia: compStr, documentId: guia.id }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Erro ao gerar guia.");
        }
        const data = await res.json();
        
        if (data.status === "waiting_accountant") {
           setMensagemEnviada(true);
           onAtualizado({...guia, status: "waiting_accountant", aguardandoContador: true});
        } else {
           setAtualizada(true);
           setNovaDataVencimento(data.dataVencimento);
           setNovoValor(data.valorTotal);
           setPdfPath(data.pdfPath);
           if (data.pixCode) {
               setPixCode(data.pixCode);
           }
           onAtualizado({
             ...guia,
             status: "GUIA_ATUALIZADA",
             dataVencimento: data.dataVencimento,
             valor: data.valorTotal,
             pixCode: data.pixCode
           });
        }
      } else {
         // Envia mensagem ao contador
         const msg = `Por favor, preciso recalcular a guia: ${tipoLabel} - Competência: ${guia.competencia}.`;
         const res = await fetch(`/api/client/message`, {
             method: "POST",
             headers: {
                 "Content-Type": "application/json",
                 "Authorization": `Bearer ${token}`
             },
             body: JSON.stringify({ content: msg, clientId: clienteId })
         });
         
         if (!res.ok) {
            throw new Error("Erro ao enviar mensagem.");
         }
         
         await fetch(`/api/client/mark-doc/${guia.id}`, {
             method: "POST",
             headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
             body: JSON.stringify({ status: "waiting_accountant" })
         });

         setMensagemEnviada(true);
         onAtualizado({...guia, aguardandoContador: true});
      }
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }

  const handleCopyPix = () => {
      navigator.clipboard.writeText(pixCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
  };

  const getAuthenticatedFileUrl = (url: string | null) => {
    if (!url) return "";
    const token = localStorage.getItem('clientToken') || sessionStorage.getItem('clientToken');
    return `${url}?token=${token}`;
  };

  return (
    <>
      {/* MODAL DE CARREGAMENTO PREMIUM COM BACKDROP BLUR E GRADIENT PULSE */}
      {loading && isSupported && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 backdrop-blur-md transition-all duration-300">
           <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200/50 dark:border-slate-800/80 p-8 rounded-3xl shadow-2xl flex flex-col items-center gap-5 max-w-sm mx-4 text-center animate-in zoom-in-95 duration-200">
               <div className="relative w-16 h-16 flex items-center justify-center">
                   {/* Anel de carregamento gradiente */}
                   <div className="absolute inset-0 rounded-full border-4 border-slate-100 dark:border-slate-800"></div>
                   <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-600 dark:border-t-indigo-400 animate-spin"></div>
                   <RefreshCw className="w-6 h-6 text-indigo-600 dark:text-indigo-400 animate-pulse" />
               </div>
               <div className="space-y-1.5">
                   <h3 className="font-extrabold text-lg text-slate-950 dark:text-white tracking-tight">Recalculando Guia</h3>
                   <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                       Acessando os servidores do <strong className="text-indigo-600 dark:text-indigo-400">Integra Contador</strong> para calcular multas, encargos e gerar o novo PIX.
                   </p>
               </div>
           </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5 w-full mt-2">
        {isOverdue && !atualizada && !mensagemEnviada && (
          <button
            onClick={handleAtualizar}
            disabled={loading}
            className="group relative flex items-center justify-center gap-2 h-10 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.97] text-white text-xs font-black rounded-xl shadow-md shadow-indigo-200 dark:shadow-none hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none w-full"
            title={`Recalcular ${tipoLabel}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-500 ${loading ? "animate-spin" : ""}`} />
            {loading ? (isSupported ? "Calculando..." : "Solicitando...") : `Recalcular Guia em Atraso`}
          </button>
        )}

        {/* CARTÃO DE SUCESSO PREMIUM PÓS-RECÁLCULO */}
        {atualizada && novaDataVencimento && (
          <div className="bg-gradient-to-br from-emerald-50/80 to-teal-50/40 dark:from-emerald-950/20 dark:to-teal-950/10 border border-emerald-200/60 dark:border-emerald-900/40 rounded-2xl p-4 shadow-xs flex flex-col gap-3.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <Check className="w-3.5 h-3.5 font-bold" />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-black text-emerald-900 dark:text-emerald-300">Guia Atualizada com Sucesso!</p>
                <p className="text-[10px] text-emerald-600/90 dark:text-emerald-400/80 leading-relaxed">
                  Encargos e multas calculados até a nova data de vencimento.
                </p>
              </div>
            </div>

            {/* Metadados da guia recalculada */}
            <div className="grid grid-cols-2 gap-2 bg-white/65 dark:bg-slate-900/40 border border-emerald-100/50 dark:border-emerald-900/20 rounded-xl p-2.5 text-center">
              <div className="border-r border-emerald-100/40 dark:border-emerald-900/20">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Novo Vencimento</p>
                <p className="text-xs font-black text-slate-800 dark:text-emerald-200 mt-0.5">
                  {novaDataVencimento.split("-").reverse().join("/")}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Valor Total</p>
                <p className="text-xs font-black text-slate-800 dark:text-emerald-200 mt-0.5">
                  {novoValor ? novoValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "N/D"}
                </p>
              </div>
            </div>

            {/* Ações interativas premium */}
            <div className="flex gap-2 w-full">
              {pdfPath && (
                <a 
                  href={getAuthenticatedFileUrl(pdfPath)} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="flex-1 flex items-center justify-center gap-1.5 h-9 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-[11px] font-extrabold rounded-xl transition-colors shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" /> PDF Guia
                </a>
              )}
              {pixCode && (
                <button
                  onClick={handleCopyPix}
                  className={`flex-1 flex items-center justify-center gap-1.5 h-9 text-[11px] font-extrabold rounded-xl transition-all duration-200 active:scale-[0.97] shadow-sm ${
                    copied 
                      ? "bg-emerald-600 text-white" 
                      : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100 dark:shadow-none"
                  }`}
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 animate-in zoom-in duration-200" /> PIX Copiado!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copiar PIX
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {/* STATUS AGUARDANDO CONTADOR */}
        {mensagemEnviada && (
          <div className="flex items-start gap-2.5 p-3.5 bg-blue-50/70 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-2xl animate-in fade-in duration-300">
              <Send className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                  <p className="text-xs font-black text-blue-950 dark:text-blue-350">Solicitação Enviada</p>
                  <p className="text-[10px] text-blue-600 dark:text-blue-400 leading-relaxed">
                      Como esta guia não suporta recálculo automático via API, enviamos uma notificação direta ao seu contador para que ele realize o cálculo manualmente e nos envie.
                  </p>
              </div>
          </div>
        )}

        {/* ALERTA DE ERRO INTEGRADO */}
        {erro && (
          <div className="flex items-center gap-2 p-2.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-xl animate-in shake duration-300">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-extrabold leading-tight">{erro}</span>
          </div>
        )}
      </div>
    </>
  );
}
