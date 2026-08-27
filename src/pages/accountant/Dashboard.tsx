import { apiFetch } from "../../lib/apiClient";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Inbox,
  FileText,
  CheckCircle,
  Users,
  AlertTriangle,
  Clock,
  History,
} from "lucide-react";
import { Skeleton } from "../../components/Skeleton";
import { documentFileUrl } from "../../lib/apiClient";

interface Overview {
  clients: number;
  clientsIrregular: number;
  inbox: number;
  waitingRecalc: number;
  overdue: number;
  dueSoon: number;
}

export function AccountantDashboard() {
  const [inbox, setInbox] = useState<any[] | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [audit, setAudit] = useState<any[]>([]);

  useEffect(() => {
    apiFetch("/api/accountant/inbox", {}, "accountant")
      .then((r) => r.json())
      .then((res) => setInbox(res.docs || []))
      .catch(() => setInbox([]));

    apiFetch("/api/accountant/overview", {}, "accountant")
      .then((r) => r.json())
      .then((res) => setOverview(res))
      .catch(() => {});

    apiFetch("/api/accountant/audit?limit=8", {}, "accountant")
      .then((r) => r.json())
      .then((res) => setAudit(res.entries || []))
      .catch(() => {});
  }, []);

  const kpis = [
    { label: "Clientes", value: overview?.clients, icon: Users, to: "/admin/clients", tone: "text-slate-600 bg-slate-100" },
    { label: "Irregulares", value: overview?.clientsIrregular, icon: AlertTriangle, to: "/admin/clients", tone: "text-amber-600 bg-amber-100" },
    { label: "Na inbox", value: overview?.inbox, icon: Inbox, to: "/admin", tone: "text-blue-600 bg-blue-100" },
    { label: "Recálculo pedido", value: overview?.waitingRecalc, icon: Clock, to: "/admin", tone: "text-purple-600 bg-purple-100" },
    { label: "Guias vencidas", value: overview?.overdue, icon: AlertTriangle, to: "/admin/clients", tone: "text-rose-600 bg-rose-100" },
    { label: "Vencem em 7d", value: overview?.dueSoon, icon: Clock, to: "/admin/clients", tone: "text-emerald-600 bg-emerald-100" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in">
      <header className="h-16 flex items-center justify-between px-8 bg-white/40 backdrop-blur-md border border-white rounded-2xl shadow-sm -mx-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Visão Geral</h1>
          <p className="text-xs text-slate-500">Central de recebimento e acompanhamento de clientes.</p>
        </div>
      </header>

      {/* KPI ROW */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Link
              key={k.label}
              to={k.to}
              className="bg-white/80 backdrop-blur-xl border border-white rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${k.tone}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="text-2xl font-bold text-slate-900 leading-none">
                {k.value ?? <span className="text-slate-300">–</span>}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">{k.label}</div>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* INBOX */}
        <div className="lg:col-span-2 bg-white/80 backdrop-blur-xl border text-slate-900 border-white rounded-3xl overflow-hidden shadow-xl shadow-slate-200/50">
          <div className="px-6 py-4 border-b border-white bg-white/50 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Últimos Documentos Recebidos</h3>
            <Inbox className="w-5 h-5 text-slate-400" />
          </div>
          <div className="divide-y divide-slate-100/50">
            {inbox === null && (
              <div className="p-4 px-6 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )}
            {inbox?.length === 0 && (
              <div className="p-8 text-center text-slate-500">Nenhum documento pendente.</div>
            )}
            {inbox?.map((doc: any) => (
              <div key={doc.id} className="p-4 px-6 hover:bg-white flex items-center justify-between">
                <div className="flex items-center">
                  <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mr-4">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-slate-900">
                      {doc.title}{" "}
                      {doc.status === "waiting_accountant" && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                          Recálculo Solicitado
                        </span>
                      )}
                    </h4>
                    <div className="text-xs text-slate-500 mt-1 flex gap-2 items-center flex-wrap">
                      <Link to={`/admin/client/${doc.clientId}`} className="font-medium text-slate-700 hover:text-blue-600">
                        {doc.clientName}
                      </Link>
                      <span>•</span>
                      {doc.competence && (
                        <>
                          <span className="font-bold text-slate-800">Comp: {doc.competence}</span>
                          <span>•</span>
                        </>
                      )}
                      <span>{format(parseISO(doc.createdAt), "dd MMM, yyyy", { locale: ptBR })}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {doc.fileUrl && (
                    <a
                      href={documentFileUrl(doc.id, { download: true, as: "accountant" })}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Baixar Arquivo
                    </a>
                  )}
                  <Link
                    to={`/admin/client/${doc.clientId}`}
                    className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"
                    title="Abrir cliente"
                  >
                    <CheckCircle className="w-5 h-5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RECENT ACTIVITY */}
        <div className="bg-white/80 backdrop-blur-xl border border-white rounded-3xl overflow-hidden shadow-xl shadow-slate-200/50">
          <div className="px-6 py-4 border-b border-white bg-white/50 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Atividade recente</h3>
            <History className="w-5 h-5 text-slate-400" />
          </div>
          <div className="divide-y divide-slate-100/50">
            {audit.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-sm">Sem registros ainda.</div>
            )}
            {audit.map((e: any) => (
              <div key={e.id} className="px-6 py-3">
                <p className="text-sm text-slate-700">{e.summary || e.action}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {format(parseISO(e.createdAt), "dd MMM, HH:mm", { locale: ptBR })} · {e.actor}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
