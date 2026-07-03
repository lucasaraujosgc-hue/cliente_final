import { apiFetch } from "../../lib/apiClient";
import React, { useState, useEffect } from "react";
import { format, isBefore, parseISO, startOfDay, differenceInDays } from "date-fns";
import { AlertCircle, FileText, Download, CheckCircle, Clock, RotateCw, Calendar, DollarSign, Send } from "lucide-react";
import { PixScannerButton } from "../../components/PixScannerButton";
import { GuiaAtualizarButton } from "../../components/GuiaAtualizarButton";

export function ClientOverdue() {
  const [loading, setLoading] = useState(true);
  const [overdueDocs, setOverdueDocs] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = async () => {
    setIsRefreshing(true);
    const token = localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");
    try {
      const response = await apiFetch("/api/client/dashboard", {
        
      });
      const data = await response.json();
      
      const today = startOfDay(new Date());
      
      // Filtra documentos enviados pelo contador que estão pendentes e com prazo expirado
      const overdue = data.documents.filter((doc: any) => {
        if (doc.status === "paid") return false;
        if (!doc.dueDate) return false;
        
        try {
          let dueDateObj;
          if (doc.dueDate.includes("/")) {
            const [day, month, year] = doc.dueDate.split("/").map(Number);
            dueDateObj = new Date(year, month - 1, day);
          } else if (doc.dueDate.includes("-")) {
            const parts = doc.dueDate.split("T")[0].split("-");
            dueDateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          } else {
            dueDateObj = parseISO(doc.dueDate);
          }
          if (isNaN(dueDateObj.getTime())) return false;
          
          return isBefore(startOfDay(dueDateObj), startOfDay(today));
        } catch (e) {
          return false;
        }
      }).sort((a: any, b: any) => {
        const parseDate = (d: string) => {
          if (!d) return 0;
          if (d.includes("/")) {
            const [day, month, year] = d.split("/").map(Number);
            return new Date(year, month - 1, day).getTime();
          } else if (d.includes("-")) {
            const parts = d.split("T")[0].split("-");
            return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
          }
          return parseISO(d).getTime();
        };
        return parseDate(a.dueDate) - parseDate(b.dueDate);
      });
      
      setOverdueDocs(overdue);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleMarkAsPaid = async (docId: string) => {
    const token = localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");
    try {
      const res = await apiFetch(`/api/client/mark-doc/${docId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          
        },
        body: JSON.stringify({ status: "paid" })
      });
      if (res.ok) {
        loadData();
      }
    } catch (err) {
      console.error("Error setting doc as paid", err);
    }
  };

  const getAuthenticatedFileUrl = (url: string | null) => {
    if (!url) return undefined;
    if (url.startsWith('/api/')) {
      const token = localStorage.getItem('clientToken') || sessionStorage.getItem('clientToken');
      return `${url}?token=${token}`;
    }
    return url;
  };

  const getDaysOverdue = (dueDateStr: string) => {
    try {
      let due;
      if (dueDateStr.includes("/")) {
        const [day, month, year] = dueDateStr.split("/").map(Number);
        due = new Date(year, month - 1, day);
      } else if (dueDateStr.includes("-")) {
        const parts = dueDateStr.split("T")[0].split("-");
        due = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      } else {
        due = parseISO(dueDateStr);
      }
      const today = startOfDay(new Date());
      due = startOfDay(due);
      return Math.abs(differenceInDays(due, today));
    } catch {
      return 0;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center h-96 space-y-4">
        <RotateCw className="w-8 h-8 text-indigo-600 animate-spin" />
        <span className="text-sm text-slate-500 font-medium animate-pulse">Buscando guias em atraso...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto px-4 sm:px-6 pb-16 animate-in fade-in slide-in-from-bottom-3 duration-550">
      
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
          <AlertCircle className="w-7 h-7 text-rose-500 shrink-0" />
          Guias em Atraso
        </h1>
        <button
          onClick={loadData}
          disabled={isRefreshing}
          className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-black transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Sincronizando..." : "Sincronizar"}
        </button>
      </div>

      {overdueDocs.length === 0 ? (
        /* CARD TUDO EM DIA */
        <div className="bg-white/70 dark:bg-slate-900/60 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/80 rounded-3xl p-16 text-center shadow-sm max-w-2xl mx-auto animate-in zoom-in-98 duration-305">
          <div className="w-20 h-20 bg-emerald-500/10 dark:bg-emerald-500/5 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-500/20 shadow-inner">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
          </div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">Tudo em Dia! 🎉</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
            Parabéns, você não possui nenhuma guia ou imposto pendente em atraso. Sua empresa está regularizada.
          </p>
        </div>
      ) : (
        /* GRID DE GUIAS EM ATRASO */
        <div className="space-y-3">
          {overdueDocs.map((doc: any) => {
            const daysOverdue = getDaysOverdue(doc.dueDate);
            const isHighlighted = true;
            return (
              <div 
                key={doc.id} 
                className="relative overflow-hidden p-4 rounded-2xl border transition-all bg-gradient-to-r from-red-50/50 to-amber-50/20 shadow-xs border-amber-200 dark:from-rose-950/15 dark:to-amber-950/5 dark:border-rose-900/40"
              >
                <div className="absolute top-0 bottom-0 left-0 w-1.5 bg-rose-500" />

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="p-2.5 rounded-xl shrink-0 mt-0.5 sm:mt-0 bg-rose-500/10 text-rose-500 dark:bg-rose-500/20">
                      <AlertCircle className="w-5 h-5 animate-pulse" />
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm capitalize">
                          {doc.category === 'taxes' ? 'Impostos' : doc.category === 'payroll' ? 'Folha' : (doc.category || 'Geral')}
                        </h4>
                        <span className="px-2 py-0.5 text-[9px] font-extrabold uppercase rounded-full bg-rose-500/10 text-rose-600 border border-rose-500/20 animate-pulse">
                          Atrasado {daysOverdue} {daysOverdue === 1 ? "dia" : "dias"}
                        </span>
                        {doc.competence && (
                          <span className="px-2 py-0.5 text-[9px] font-extrabold uppercase rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            Comp: {doc.competence}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" /> Vencimento: <strong className="text-slate-700 dark:text-slate-300 font-extrabold">{doc.dueDate ? (doc.dueDate.includes("-") ? `${doc.dueDate.split("T")[0].split("-")[2]}/${doc.dueDate.split("T")[0].split("-")[1]}/${doc.dueDate.split("T")[0].split("-")[0]}` : doc.dueDate) : "N/D"}</strong>
                        </span>
                        {doc.extractedData?.extractedValue && (
                          <>
                            <span>•</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                              <DollarSign className="w-3 h-3 text-slate-400" /> {doc.extractedData.extractedValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          </>
                        )}
                        <span>•</span>
                        <span className="font-medium break-all">Arquivo: {doc.title || "Documento"}</span>
                      </div>
                    </div>
                  </div>

                  {doc.status === "waiting_accountant" ? (
                     <div className="flex items-center p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl mt-3 sm:mt-0 sm:self-center w-full sm:w-auto">
                         <span className="text-xs font-bold text-blue-700 dark:text-blue-400 flex items-center gap-1">
                             <Send className="w-3.5 h-3.5" /> Aguardando contador.
                         </span>
                     </div>
                  ) : (
                    <div className="flex flex-col gap-2 self-start sm:self-center w-full sm:w-auto mt-2 sm:mt-0">
                      <div className="flex flex-wrap items-center justify-end sm:justify-start gap-2">
                        {doc.fileUrl && (
                          <a
                            href={getAuthenticatedFileUrl(doc.fileUrl)}
                            download
                            target="_blank"
                            rel="noreferrer"
                            className="flex-1 sm:flex-none h-8 px-3 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-black transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Baixar
                          </a>
                        )}
                        {doc.fileUrl && doc.fileUrl.toLowerCase().endsWith(".pdf") && (
                          <div className="flex-1 sm:flex-none">
                            <PixScannerButton docId={doc.id} fileUrl={getAuthenticatedFileUrl(doc.fileUrl) || ""} />
                          </div>
                        )}
                        <button
                          onClick={() => handleMarkAsPaid(doc.id)}
                          className="flex-1 sm:flex-none h-8 px-3 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-lg text-[10px] font-black transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Pago
                        </button>
                      </div>
                      {(doc.category === "DCTFWEB" || doc.category === "SIMPLES_NACIONAL" || doc.category === "taxes" || doc.title?.toUpperCase().includes("DCTFWEB") || doc.title?.toUpperCase().includes("SIMPLES")) && (
                        <div className="w-full">
                          <GuiaAtualizarButton 
                            clienteId={doc.clientId}
                            guia={{
                              id: doc.id,
                              tipoGuia: (doc.category === "DCTFWEB" || doc.title?.toUpperCase().includes("DCTFWEB")) ? "DCTFWEB_INSS" : "DAS_SIMPLES",
                              competencia: doc.competence || "01/2026",
                              status: doc.status
                            }}
                            isOverdue={true}
                            onAtualizado={() => loadData()}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
