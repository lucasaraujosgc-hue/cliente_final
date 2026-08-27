import { AlertCircle, CheckCircle, Copy, Calendar, Clock, Check, Eye, Send, DollarSign, Download } from "lucide-react";
import { PixScannerButton } from "../../../components/PixScannerButton";
import { GuiaAtualizarButton } from "../../../components/GuiaAtualizarButton";
import { handleFileAction } from "../../../lib/utils";
import { documentFileUrl } from "../../../lib/apiClient";

export interface DocDueStatus {
  label: string;
  colorClass: string;
  badgeColor: string;
  priority: number;
  isOverdue?: boolean;
  isSoon?: boolean;
}

interface DueDatesCardProps {
  docs: any[];
  selectedCompetence: string;
  clientId: string;
  copiedId: string | null;
  getDocDueStatus: (doc: any) => DocDueStatus;
  onCopyCode: (docId: string, textToCopy: string) => void;
  onMarkAsPaid: (docId: string) => void;
  onReloadData: () => void;
}

export function DueDatesCard({
  docs,
  selectedCompetence,
  clientId,
  copiedId,
  getDocDueStatus,
  onCopyCode,
  onMarkAsPaid,
  onReloadData,
}: DueDatesCardProps) {
  return (
    <div className="bg-white/80 dark:bg-slate-800/90 backdrop-blur-lg rounded-3xl border border-slate-150/80 dark:border-slate-800/80 p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-700/50 gap-2 mb-4">
        <div>
          <h3 className="font-black text-slate-800 dark:text-white text-base flex items-center gap-1.5">
            <Clock className="w-5 h-5 text-amber-500" />
            Próximos Vencimentos de Guias e Impostos
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Acompanhe e pague as guias enviadas pelo escritório. Data de referência: 22/06/2026.
          </p>
        </div>
        <span className="self-start sm:self-center px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-350 text-[10px] font-bold rounded-lg uppercase tracking-wide">
          Competência: {selectedCompetence}
        </span>
      </div>

      {docs.length === 0 ? (
        <div className="py-12 text-center rounded-2xl bg-slate-50/50 dark:bg-slate-900/10 border border-slate-100 dark:border-slate-800/50">
          <CheckCircle className="w-10 h-10 text-emerald-400 dark:text-emerald-500/30 mx-auto mb-2" />
          <h4 className="font-bold text-slate-800 dark:text-slate-300 text-sm">Limpo e Seguro!</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 leading-relaxed">
            Nenhum documento contábil emitido ou com vencimento cadastrado para {selectedCompetence}.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc: any) => {
            const dueInfo = getDocDueStatus(doc);
            const isHighlighted = dueInfo.isOverdue || dueInfo.isSoon;

            return (
              <div
                key={doc.id}
                className={`relative overflow-hidden p-4 rounded-2xl border transition-all ${
                  isHighlighted
                    ? "bg-gradient-to-r from-red-50/50 to-amber-50/20 shadow-xs border-amber-200 dark:from-rose-950/15 dark:to-amber-950/5 dark:border-rose-900/40"
                    : doc.status === "paid"
                      ? "bg-white/40 dark:bg-slate-900/10 border-slate-100 dark:border-slate-800 opacity-75"
                      : "bg-white dark:bg-slate-900/30 border-slate-200 hover:border-slate-300 dark:border-slate-805 dark:hover:border-slate-700"
                }`}
              >
                {isHighlighted && (
                  <div className={`absolute top-0 bottom-0 left-0 w-1.5 ${dueInfo.isOverdue ? 'bg-rose-500' : 'bg-amber-500'}`} />
                )}

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 sm:mt-0 ${
                      doc.status === "paid"
                        ? "bg-emerald-500/10 text-emerald-500"
                        : dueInfo.isOverdue
                          ? "bg-rose-500/10 text-rose-500 dark:bg-rose-500/20"
                          : "bg-amber-500/10 text-amber-500 dark:bg-amber-500/20"
                    }`}>
                      {doc.status === "paid" ? (
                        <Check className="w-5 h-5 text-emerald-500" />
                      ) : (
                        <AlertCircle className={`w-5 h-5 ${dueInfo.isOverdue ? 'animate-pulse' : ''}`} />
                      )}
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm capitalize">
                          {doc.category === 'taxes' ? 'Impostos' : doc.category === 'payroll' ? 'Folha' : (doc.category || 'Geral')}
                        </h4>
                        <span className={`px-2 py-0.5 text-[9px] font-extrabold uppercase rounded-full ${dueInfo.colorClass}`}>
                          {dueInfo.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" /> Vencimento: <strong className="text-slate-700 dark:text-slate-300 font-extrabold">{doc.dueDate ? (doc.dueDate.includes("-") ? `${doc.dueDate.split("T")[0].split("-")[2]}/${doc.dueDate.split("T")[0].split("-")[1]}/${doc.dueDate.split("T")[0].split("-")[0]}` : doc.dueDate) : "N/D"}</strong>
                        </span>
                        {doc.extractedData?.extractedValue && !['contracheque', 'outros', 'payroll'].includes(doc.category?.toLowerCase()) && (
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
                        <Send className="w-3.5 h-3.5" /> Aguardando contador enviar a guia.
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                      <div className="flex flex-wrap items-center justify-end sm:justify-start gap-2">
                        {doc.fileUrl && (
                          <>
                            <button
                              onClick={() => handleFileAction(documentFileUrl(doc.id), 'view', doc.title || 'documento')}
                              className="flex-1 sm:flex-none h-10 px-3 flex items-center justify-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 text-xs font-bold rounded-xl text-slate-700 dark:text-slate-300 transition-colors shrink-0 cursor-pointer"
                              title="Visualizar documento"
                            >
                              <Eye className="w-3.5 h-3.5 mr-1.5" /> Ver Arquivo
                            </button>
                            <button
                              onClick={() => handleFileAction(documentFileUrl(doc.id, { download: true }), 'download', doc.title || 'documento')}
                              className="h-10 w-10 flex items-center justify-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 text-xs font-bold rounded-xl text-slate-700 dark:text-slate-300 transition-colors shrink-0 cursor-pointer"
                              title="Baixar Arquivo"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        {doc.pixCode ? (
                          <button
                            onClick={() => onCopyCode(doc.id, doc.pixCode)}
                            className="flex-1 sm:flex-none h-10 px-3 w-full sm:w-auto bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-100 dark:border-indigo-800/50 text-indigo-700 dark:text-indigo-300 text-xs font-bold rounded-xl transition-all flex items-center justify-center min-w-[100px]"
                          >
                            {copiedId === doc.id ? (
                              <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 animate-pulse">
                                <Check className="w-3.5 h-3.5" /> Copiado!
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 font-bold">
                                <Copy className="w-3 h-3 text-indigo-400" /> Copiar qrcode pix
                              </span>
                            )}
                          </button>
                        ) : (
                          doc.fileUrl && doc.fileUrl.toLowerCase().endsWith(".pdf") && (
                            <div className="flex-1 sm:flex-none">
                              <PixScannerButton docId={doc.id} />
                            </div>
                          )
                        )}

                        {doc.status !== "paid" && doc.dueDate && !['contracheque', 'outros', 'payroll'].includes(doc.category?.toLowerCase()) ? (
                          <button
                            onClick={() => onMarkAsPaid(doc.id)}
                            className="flex-1 sm:flex-none h-10 px-3 bg-slate-900 border border-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:border-emerald-500 dark:text-white dark:hover:bg-emerald-600 text-white text-xs font-bold rounded-xl shadow-xs transition-transform active:scale-95"
                          >
                            Marcar como Pago
                          </button>
                        ) : doc.status === "paid" ? (
                          <div className="flex-1 sm:flex-none h-10 px-3 bg-slate-100 dark:bg-slate-800 text-emerald-600 dark:text-emerald-500 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs opacity-70">
                            <CheckCircle className="w-4 h-4" />
                            Pago
                          </div>
                        ) : null}
                      </div>
                      {doc.status !== "paid" && (
                        <div className="w-full mt-2">
                          <GuiaAtualizarButton
                            clienteId={clientId}
                            guia={{
                              id: doc.id,
                              tipoGuia: (doc.category === "DCTFWEB" || doc.category === "INSS" || doc.category?.toUpperCase()?.includes("INSS") || doc.title?.toUpperCase()?.includes("DCTFWEB") || doc.title?.toUpperCase()?.includes("INSS")) ? "DCTFWEB_INSS" : ((doc.category === "SIMPLES_NACIONAL" || doc.category?.toUpperCase()?.includes("SIMPLES") || doc.title?.toUpperCase()?.includes("SIMPLES")) ? "DAS_SIMPLES" : "OUTROS"),
                              competencia: doc.competence || selectedCompetence || "01/2026",
                              status: doc.status,
                              title: doc.title,
                            }}
                            isOverdue={dueInfo.isOverdue}
                            onAtualizado={() => onReloadData()}
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
