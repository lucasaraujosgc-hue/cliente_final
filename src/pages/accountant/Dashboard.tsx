import { apiFetch } from "../../lib/apiClient";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Inbox, FileText, CheckCircle } from "lucide-react";

export function AccountantDashboard() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    // Carregar Caixa de Entrada (Uploads dos clientes)
    apiFetch("/api/accountant/inbox", {
      
    }, "accountant")
      .then(r => r.json())
      .then(res => setData({ inbox: res.docs }));
  }, []);

  if (!data) return null;

  return (
    <div className="space-y-8 animate-in fade-in">
      <header className="h-16 flex items-center justify-between px-8 bg-white/40 backdrop-blur-md border border-white rounded-2xl shadow-sm -mx-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Inbox & Envios</h1>
          <p className="text-xs text-slate-500">Central de recebimento de documentos dos clientes.</p>
        </div>
      </header>

      <div className="bg-white/80 backdrop-blur-xl border text-slate-900 border-white rounded-3xl overflow-hidden shadow-xl shadow-slate-200/50">
        <div className="px-6 py-4 border-b border-white bg-white/50 flex items-center justify-between">
           <h3 className="font-semibold text-slate-800">Últimos Documentos Recebidos</h3>
           <Inbox className="w-5 h-5 text-slate-400" />
        </div>
        <div className="divide-y divide-slate-100/50">
          {data.inbox.length === 0 && (
            <div className="p-8 text-center text-slate-500">Nenhum documento pendente.</div>
          )}
          {data.inbox.map((doc: any) => (
            <div key={doc.id} className="p-4 px-6 hover:bg-white flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mr-4">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-slate-900">
                    {doc.title} {doc.status === "waiting_accountant" && <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">Recálculo Solicitado</span>}
                  </h4>
                  <div className="text-xs text-slate-500 mt-1 flex gap-2 items-center">
                     <span className="font-medium text-slate-700">{doc.clientName}</span>
                     <span>•</span>
                     {doc.competence && (
                       <>
                         <span className="font-bold text-slate-800">Comp: {doc.competence}</span>
                         <span>•</span>
                       </>
                     )}
                     <span>{format(parseISO(doc.createdAt), "dd MMM, yyyy", {locale: ptBR})}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                 <button className="text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors">
                   Baixar Arquivo
                 </button>
                 <button className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors" title="Marcar como processado">
                   <CheckCircle className="w-5 h-5" />
                 </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
