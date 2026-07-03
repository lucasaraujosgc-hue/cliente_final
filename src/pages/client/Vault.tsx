import { apiFetch } from "../../lib/apiClient";
import { useState, useEffect, FormEvent } from "react";
import { Folder, Receipt, FileIcon, Eye, Download, UploadCloud, Clock, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, QrCode } from "lucide-react";
import { format, parseISO, differenceInDays, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { handleFileAction } from "../../lib/utils";

export function ClientVault() {
  const [docs, setDocs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("company");
  const [selectedCompetence, setSelectedCompetence] = useState(format(subMonths(new Date(), 1), "MM/yyyy"));
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const availableCompetences = Array.from({ length: 24 }, (_, i) => format(subMonths(new Date(), i), "MM/yyyy"));

  const handlePrevCompetence = () => {
    const idx = availableCompetences.indexOf(selectedCompetence);
    if (idx < availableCompetences.length - 1) {
      setSelectedCompetence(availableCompetences[idx + 1]);
    }
  };

  const handleNextCompetence = () => {
    const idx = availableCompetences.indexOf(selectedCompetence);
    if (idx > 0) {
      setSelectedCompetence(availableCompetences[idx - 1]);
    }
  };

  const loadDocs = () => {
    apiFetch("/api/client/dashboard", {
      
    })
      .then(r => r.json())
      .then(data => setDocs(data.documents || []))
      .catch(e => console.error("Error loading vault docs", e));
  };

  useEffect(() => loadDocs(), []);

  const handleUpload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const title = formData.get("title") as string;
    
    await apiFetch("/api/client/upload", {
      method: "POST",
      headers: { 
        
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title, category: "upload" })
    });
    
    (e.target as HTMLFormElement).reset();
    loadDocs();
    alert("Enviado com sucesso para a contabilidade!");
  };

  const tabs = [
    { id: "company", label: "Documentos Empresa", icon: FileIcon },
  ];

  const filteredDocs = docs.filter(d => {
    if (activeTab === "received") {
      return (d.category === "taxes" || d.category === "payroll" || d.category === "webhook_doc" || d.category === "SITFIS_RECEITA") && d.competence === selectedCompetence;
    }
    if (activeTab === "company") {
      return d.category === "company";
    }
    return d.category === activeTab;
  });

  // Helper parser for Brazilian date strings DD/MM/YYYY
  const parseDueDate = (dateStr?: string) => {
    if (!dateStr) return null;
    try {
      if (dateStr.includes("/")) {
        const [day, month, year] = dateStr.split("/").map(Number);
        return new Date(year, month - 1, day);
      }
      return new Date(dateStr);
    } catch (e) {
      return null;
    }
  };

  // Generate highlight metadata for files with upcoming maturities (due-dates)
  const getDueHighlight = (doc: any) => {
    if (doc.status === "paid") {
      return { 
        text: "Pago", 
        badgeStyle: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300", 
        borderStyle: "border-slate-100 dark:border-slate-800/60" 
      };
    }
    if (!doc.dueDate) {
      return { 
        text: "Pendente", 
        badgeStyle: "bg-amber-100 text-amber-800 dark:bg-amber-950/20 dark:text-amber-400", 
        borderStyle: "border-slate-200 dark:border-slate-800" 
      };
    }

    const todayDate = new Date(2026, 5, 22); // Target reference June 22, 2026
    const parsedDue = parseDueDate(doc.dueDate);

    if (!parsedDue) {
      return { 
        text: "Pendente", 
        badgeStyle: "bg-amber-100 text-amber-800 dark:bg-amber-950/20 dark:text-amber-400", 
        borderStyle: "border-slate-200 dark:border-slate-800" 
      };
    }

    const diffDays = differenceInDays(parsedDue, todayDate);

    if (diffDays < 0) {
      return { 
        text: `Atrasado há ${Math.abs(diffDays)}d 🚨`, 
        badgeStyle: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400 animate-pulse font-extrabold", 
        borderStyle: "border-rose-200 dark:border-rose-900/60 bg-rose-50/10 dark:bg-rose-950/5",
        isAlert: true 
      };
    } else if (diffDays <= 4) {
      return { 
        text: `Vence em ${diffDays}d ⚠️`, 
        badgeStyle: "bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400 font-extrabold", 
        borderStyle: "border-amber-200 dark:border-amber-900/40 bg-amber-50/10 dark:bg-amber-950/5",
        isAlert: true 
      };
    } else {
      return { 
        text: `Pendente (Vence em ${doc.dueDate})`, 
        badgeStyle: "bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400", 
        borderStyle: "border-slate-200 dark:border-slate-800" 
      };
    }
  };

  return (
    <div className="space-y-6 pb-20 px-4 sm:px-6 max-w-7xl mx-auto">
      <header className="pt-3">
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Cofre Digital</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Acesse, baixe e visualize guias, folha de pagamento e certidões enviadas pelo escritório.</p>
      </header>

      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border border-slate-100 dark:border-slate-850 rounded-3xl overflow-hidden shadow-sm">
        
        {/* Responsive, fluid custom tabs bar */}
        <div className="flex border-b border-slate-100 dark:border-slate-700/50 overflow-x-auto p-2 scrollbar-thin">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center px-4 py-2.5 text-xs font-bold whitespace-nowrap transition-colors rounded-xl min-h-[44px] ${
                  activeTab === tab.id 
                    ? "bg-slate-900 text-white dark:bg-virgula-green dark:text-white" 
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100/50 dark:hover:bg-slate-700/30"
                }`}
              >
                <Icon className="w-4 h-4 mr-2" />
                {tab.label}
              </button>
            )
          })}
        </div>
        
        <div className="p-4 sm:p-6">
          {activeTab === "received" && (
            <div className="mb-6 flex items-center gap-3">
              <div className="flex items-center bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden h-10 w-[200px]">
                <button 
                  onClick={handlePrevCompetence}
                  disabled={availableCompetences.indexOf(selectedCompetence) === availableCompetences.length - 1}
                  className="px-3 h-full flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors"
                >
                   <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex-1 flex flex-col items-center justify-center">
                   <span className="text-[10px] font-semibold text-slate-400 leading-none mb-0.5">Competência</span>
                   <span className="text-sm font-black text-slate-800 dark:text-white leading-none">{selectedCompetence}</span>
                </div>
                <button 
                  onClick={handleNextCompetence}
                  disabled={availableCompetences.indexOf(selectedCompetence) === 0}
                  className="px-3 h-full flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors"
                >
                   <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {filteredDocs.length === 0 ? (
            <div className="py-16 text-center text-slate-400/80">
              <Folder className="w-12 h-12 text-slate-300 dark:text-slate-650 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Nenhum documento cadastrado</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Sua contabilidade ainda não postou documentos nesta categoria.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredDocs.map(doc => {
                const highlights = activeTab === "received" ? getDueHighlight(doc) : { borderStyle: "border-slate-200 dark:border-slate-800", badgeStyle: "hidden", text: "", isAlert: false };

                return (
                  <div 
                    key={doc.id} 
                    className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-2xl transition-all gap-4 ${highlights.borderStyle} ${
                      doc.status !== "paid" && doc.dueDate ? "bg-slate-50/20 dark:bg-slate-900/10 hover:shadow-xs" : "bg-white/50 dark:bg-slate-900/5 hover:bg-white dark:hover:bg-slate-850"
                    }`}
                  >
                    <div className="flex items-start sm:items-center">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mr-4 shrink-0 shadow-xs border ${
                        highlights.isAlert 
                          ? "bg-rose-50 border-rose-200 text-rose-500 dark:bg-rose-950/30 dark:border-rose-900/50" 
                          : "bg-white dark:bg-slate-805 border-slate-100 dark:border-slate-800 text-slate-500"
                      }`}>
                        {doc.category === 'taxes' ? <Receipt className="w-5 h-5" /> : <FileIcon className="w-5 h-5" />}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-bold text-slate-800 dark:text-white text-sm">{doc.title}</h4>
                          {activeTab === "received" && (
                            <span className={`px-2 py-0.5 text-[9px] uppercase font-bold rounded-full ${highlights.badgeStyle}`}>
                              {highlights.text}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-450 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>Adicionado em: {format(parseISO(doc.createdAt), "dd/MM/yyyy", { locale: ptBR })}</span>
                          {activeTab === "received" && (
                            <>
                              <span>•</span>
                              <span>Competência: {doc.competence || "Todos"}</span>
                            </>
                          )}
                          {doc.dueDate && activeTab === "received" && (
                            <>
                              <span>•</span>
                              <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-350">
                                <Clock className="w-3 h-3 text-amber-500" /> Vence em: {doc.dueDate}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                      {doc.pixCode && (
                         <button 
                            onClick={() => {
                               navigator.clipboard.writeText(doc.pixCode);
                               setCopiedId(doc.id);
                               setTimeout(() => setCopiedId(null), 2000);
                            }}
                            className="h-9 px-3 flex items-center justify-center bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800/50 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 rounded-xl text-xs font-bold shadow-xs transition-colors shrink-0"
                            title="Copiar qrcode pix"
                         >
                            <QrCode className="w-3.5 h-3.5 mr-1.5" /> 
                            {copiedId === doc.id ? "Copiado!" : "Copiar qrcode pix"}
                         </button>
                      )}
                      
                      {doc.fileUrl && (
                        <button 
                          onClick={() => handleFileAction(doc.fileUrl, 'view', doc.title || 'documento')}
                          className="h-9 px-3 flex items-center justify-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 rounded-xl text-xs font-bold shadow-xs transition-colors shrink-0 cursor-pointer"
                          title="Visualizar documento"
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" /> Ver Arquivo
                        </button>
                      )}
                      
                      {doc.fileUrl && (
                        <button 
                          onClick={() => handleFileAction(doc.fileUrl, 'download', doc.title || 'documento')}
                          className="h-9 w-9 flex items-center justify-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 rounded-xl shadow-xs transition-colors shrink-0 cursor-pointer"
                          title="Baixar Arquivo"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
