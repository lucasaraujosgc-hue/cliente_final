import { apiFetch, openDocument } from "../../lib/apiClient";
import { useState, useEffect, FormEvent } from "react";
import { Folder, Receipt, FileIcon, Eye, Download, UploadCloud, Clock, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, QrCode } from "lucide-react";
import { format, parseISO, differenceInDays, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

export function ClientVault() {
  const [docs, setDocs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("received");
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
    { id: "received", label: "Guias e Arquivos", icon: FileIcon },
    { id: "company", label: "Documentos Empresa", icon: FileIcon },
  ];

  const filteredDocs = docs.filter(d => {
    if (activeTab === "received") {
      const matchCompetence = !d.competence || d.competence === selectedCompetence;
      return d.uploadedBy === "accountant" && d.category !== "company" && matchCompetence;
    }
    if (activeTab === "company") {
      return d.category === "company";
    }
    return true;
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

  // Badge for a received doc: { text, tone }
  const getDueHighlight = (doc: any): { text: string; tone: "ok" | "warn" | "danger" | "muted" } => {
    if (doc.status === "paid") return { text: "Pago", tone: "ok" };
    if (!doc.dueDate) return { text: "Pendente", tone: "warn" };
    const parsedDue = parseDueDate(doc.dueDate);
    if (!parsedDue) return { text: "Pendente", tone: "warn" };
    const diff = differenceInDays(parsedDue, new Date(2026, 5, 22));
    if (diff < 0) return { text: `Atrasada ${Math.abs(diff)}d`, tone: "danger" };
    if (diff <= 4) return { text: `Vence em ${diff}d`, tone: "warn" };
    return { text: "Pendente", tone: "muted" };
  };

  const toneCls = {
    ok: "bg-brand-wash text-brand-fg",
    warn: "bg-warn-wash text-warn",
    danger: "bg-danger-wash text-danger",
    muted: "bg-sunken text-muted",
  } as const;

  const ghostBtn =
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-sunken";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[1.75rem] font-normal leading-tight text-ink">Cofre digital</h1>
        <p className="mt-1 text-sm text-muted">
          Guias, folha e certidões enviadas pelo escritório.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 shadow-xs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === tab.id ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "received" && (
          <div className="flex h-9 items-center overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
            <button
              onClick={handlePrevCompetence}
              disabled={availableCompetences.indexOf(selectedCompetence) === availableCompetences.length - 1}
              className="grid h-full w-8 place-items-center text-muted transition-colors hover:bg-sunken disabled:opacity-30"
              aria-label="Competência anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-[80px] px-1 text-center text-sm font-semibold text-ink tabular-nums">
              {selectedCompetence}
            </span>
            <button
              onClick={handleNextCompetence}
              disabled={availableCompetences.indexOf(selectedCompetence) === 0}
              className="grid h-full w-8 place-items-center text-muted transition-colors hover:bg-sunken disabled:opacity-30"
              aria-label="Próxima competência"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>

      {filteredDocs.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface px-5 py-16 text-center shadow-sm">
          <Folder className="mx-auto size-9 text-faint" strokeWidth={1.5} />
          <p className="mt-3 font-serif text-lg font-normal text-ink">Nada por aqui ainda</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
            O escritório ainda não publicou documentos nesta categoria.
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm divide-y divide-line">
          {filteredDocs.map((doc) => {
            const h = activeTab === "received" ? getDueHighlight(doc) : null;
            return (
              <li key={doc.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken text-faint">
                    {doc.category === "taxes" ? <Receipt className="size-[18px]" strokeWidth={1.9} /> : <FileIcon className="size-[18px]" strokeWidth={1.9} />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{doc.title}</span>
                      {h && (
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${toneCls[h.tone]}`}>
                          {h.text}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted tabular-nums">
                      <span>{format(parseISO(doc.createdAt), "dd/MM/yyyy", { locale: ptBR })}</span>
                      {activeTab === "received" && <span>· {doc.competence || "todas as competências"}</span>}
                      {doc.dueDate && activeTab === "received" && <span className="text-ink">· vence {doc.dueDate}</span>}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  {doc.pixCode && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(doc.pixCode);
                        setCopiedId(doc.id);
                        setTimeout(() => setCopiedId(null), 2000);
                      }}
                      className={`${ghostBtn} border-brand/30 bg-brand-wash text-brand-fg hover:bg-brand-wash`}
                    >
                      <QrCode className="size-3.5" strokeWidth={1.9} />
                      {copiedId === doc.id ? "Copiado" : "Copiar PIX"}
                    </button>
                  )}
                  {doc.fileUrl && (
                    <button onClick={() => openDocument(doc.id, "view", { filename: doc.title })} className={ghostBtn}>
                      <Eye className="size-3.5" strokeWidth={1.9} /> Ver
                    </button>
                  )}
                  {doc.fileUrl && (
                    <button onClick={() => openDocument(doc.id, "download", { filename: doc.title })} className={`${ghostBtn} w-9 px-0`} title="Baixar">
                      <Download className="size-3.5" strokeWidth={1.9} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
