import { apiFetch } from "../../lib/apiClient";
import { useState, useEffect, FormEvent } from "react";
import { UploadCloud, Folder, FileIcon, Eye, Download } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { handleFileAction } from "../../lib/utils";

export function ClientUploads() {
  const [docs, setDocs] = useState<any[]>([]);

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
    formData.append("category", "upload");
    
    await apiFetch("/api/client/upload", {
      method: "POST",
      headers: { 
        
      },
      body: formData
    });
    
    (e.target as HTMLFormElement).reset();
    loadDocs();
    alert("Enviado com sucesso para a contabilidade!");
  };

  const myUploads = docs.filter(d => d.category === "upload");

  return (
    <div className="space-y-6 pb-20 px-4 sm:px-6 max-w-7xl mx-auto">
      <header className="pt-3">
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Meus Envios</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Envie e acompanhe documentos mandados para a Contabilidade.</p>
      </header>

      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border border-slate-100 dark:border-slate-850 rounded-3xl overflow-hidden shadow-sm p-4 sm:p-6">
        
        <div className="mb-6 p-5 bg-slate-50/50 dark:bg-slate-900/30 rounded-2xl border border-slate-200 dark:border-slate-700/60 border-dashed animate-in slide-in-from-top-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-750 dark:text-slate-300 mb-3 flex items-center"><UploadCloud className="w-4 h-4 mr-2" /> Enviar novo documento para o Contador</h3>
          <form onSubmit={handleUpload} className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="w-full sm:flex-1">
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">Descrição / Finalidade do Arquivo</label>
              <input name="title" type="text" required placeholder="Ex: Extrato Bancário Conciliado Jan/2026" className="w-full h-10 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-xs bg-white dark:bg-slate-800 text-slate-850 dark:text-white transition-colors focus:ring-2 focus:ring-emerald-500/20" />
            </div>
            <div className="w-full sm:flex-1">
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">Anexo Documento (Imagens ou PDF)</label>
              <input type="file" name="file" required className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-slate-100 dark:file:bg-slate-700 file:text-slate-700 dark:file:text-slate-350 hover:file:bg-slate-200 transition-colors" />
            </div>
            <button type="submit" className="w-full sm:w-auto h-10 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 text-white px-6 rounded-xl text-xs font-bold transition-all shrink-0 shadow-sm hover:shadow">
              Enviar para Análise
            </button>
          </form>
        </div>

        {myUploads.length === 0 ? (
          <div className="py-16 text-center text-slate-400/80">
            <Folder className="w-12 h-12 text-slate-300 dark:text-slate-650 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Nenhum envio realizado</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Você ainda não enviou nenhum arquivo avulso para a contabilidade.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {myUploads.map(doc => (
              <div 
                key={doc.id} 
                className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-2xl transition-all gap-4 border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/5 hover:bg-white dark:hover:bg-slate-850"
              >
                <div className="flex items-start sm:items-center">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mr-4 shrink-0 shadow-xs border bg-white dark:bg-slate-805 border-slate-100 dark:border-slate-800 text-slate-500">
                    <FileIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                       <h4 className="font-bold text-slate-800 dark:text-white text-sm">{doc.title}</h4>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-450 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                       <span>Enviado em: {format(parseISO(doc.createdAt), "dd/MM/yyyy", { locale: ptBR })}</span>
                       <span>•</span>
                       <span>Status: {doc.status === 'viewed' || doc.status === 'ok' ? 'Contabilidade Recebeu' : 'Aguardando Análise'}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 self-end sm:self-center">
                  {doc.fileUrl && (
                    <button 
                      onClick={() => handleFileAction(doc.fileUrl, 'download', doc.title || 'documento')}
                      className="h-9 w-9 flex items-center justify-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 rounded-xl shadow-xs transition-colors cursor-pointer"
                      title="Baixar Arquivo"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
