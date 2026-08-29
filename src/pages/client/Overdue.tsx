import { apiFetch, openDocument } from "../../lib/apiClient";
import { useState, useEffect } from "react";
import { isBefore, parseISO, startOfDay, differenceInDays } from "date-fns";
import { Download, CheckCircle, RotateCw, Send } from "lucide-react";
import { PixScannerButton } from "../../components/PixScannerButton";
import { GuiaAtualizarButton } from "../../components/GuiaAtualizarButton";
import { Skeleton } from "../../components/Skeleton";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const ghostBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-sunken";

function fmtDate(d?: string | null) {
  if (!d) return "—";
  if (d.includes("-")) {
    const [y, m, day] = d.split("T")[0].split("-");
    return `${day}/${m}/${y}`;
  }
  return d;
}

export function ClientOverdue() {
  const [loading, setLoading] = useState(true);
  const [overdueDocs, setOverdueDocs] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const response = await apiFetch("/api/client/dashboard", {});
      const data = await response.json();

      const today = startOfDay(new Date());

      // Filtra documentos enviados pelo contador que estão pendentes e com prazo expirado
      const overdue = data.documents
        .filter((doc: any) => {
          if (doc.status === "paid" || doc.status === "ok") return false;
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
        })
        .sort((a: any, b: any) => {
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
    try {
      const res = await apiFetch(`/api/client/mark-doc/${docId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid" }),
      });
      if (res.ok) {
        loadData();
      }
    } catch (err) {
      console.error("Error setting doc as paid", err);
    }
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

  const totalOverdue = overdueDocs.reduce((sum, doc) => {
    const val = doc.extractedData?.extractedValue;
    return sum + (typeof val === "number" && doc.status !== "paid" ? val : 0);
  }, 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-[1.75rem] font-normal leading-tight text-ink">
            Guias em atraso
          </h1>
          {!loading && (
            <p className="mt-1 text-sm text-muted tabular-nums">
              {overdueDocs.length === 0
                ? "Sua empresa está regular."
                : `${overdueDocs.length} ${overdueDocs.length === 1 ? "guia vencida" : "guias vencidas"}${
                    totalOverdue > 0 ? ` · ${brl(totalOverdue)} no total` : ""
                  }`}
            </p>
          )}
        </div>
        <button
          onClick={loadData}
          disabled={isRefreshing}
          className={`${ghostBtn} self-start disabled:opacity-50 sm:self-auto`}
        >
          <RotateCw
            className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            strokeWidth={1.9}
          />
          {isRefreshing ? "Atualizando…" : "Atualizar"}
        </button>
      </header>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : overdueDocs.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface px-5 py-16 text-center shadow-sm">
          <CheckCircle className="mx-auto size-9 text-brand" strokeWidth={1.5} />
          <h2 className="mt-3 font-serif text-lg font-normal text-ink">
            Nenhuma guia em atraso
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
            Sua empresa está regular. As guias vencidas aparecem aqui.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {overdueDocs.map((doc: any) => {
            const days = getDaysOverdue(doc.dueDate);
            const paid = doc.status === "paid";
            const value = doc.extractedData?.extractedValue;
            return (
              <li
                key={doc.id}
                className={`rounded-xl border border-line border-l-[3px] bg-surface p-4 ${
                  paid ? "border-l-line opacity-70" : "border-l-danger"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-serif text-[15px] font-normal leading-snug text-ink">
                      {doc.title || "Documento"}
                    </h3>
                    <p className="mt-1 text-xs text-muted tabular-nums">
                      {doc.competence ? `Competência ${doc.competence} · ` : ""}
                      venceu {fmtDate(doc.dueDate)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      paid ? "bg-brand-wash text-brand-fg" : "bg-danger-wash text-danger"
                    }`}
                  >
                    {paid ? "Pago" : `Atrasada ${days} ${days === 1 ? "dia" : "dias"}`}
                  </span>
                </div>

                {value != null && (
                  <p className="mt-2 font-serif text-lg leading-none text-ink tabular-nums">
                    {brl(value)}
                  </p>
                )}

                {doc.status === "waiting_accountant" ? (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-sunken px-3 py-2 text-xs font-medium text-muted">
                    <Send className="size-3.5" strokeWidth={1.9} /> Aguardando o contador
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {doc.fileUrl && (
                        <button
                          onClick={() =>
                            openDocument(doc.id, "download", { filename: doc.title })
                          }
                          className={`${ghostBtn} flex-1 sm:flex-none`}
                        >
                          <Download className="size-3.5" strokeWidth={1.9} /> Baixar
                        </button>
                      )}
                      {doc.fileUrl?.toLowerCase().endsWith(".pdf") && (
                        <PixScannerButton docId={doc.id} />
                      )}
                      {!paid ? (
                        <button
                          onClick={() => handleMarkAsPaid(doc.id)}
                          className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-brand px-3.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-brand-strong sm:flex-none"
                        >
                          Marcar como pago
                        </button>
                      ) : (
                        <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-brand-fg">
                          <CheckCircle className="size-4" strokeWidth={1.9} /> Pago
                        </span>
                      )}
                    </div>
                    {!paid && (
                      <GuiaAtualizarButton
                        clienteId={doc.clientId}
                        guia={{
                          id: doc.id,
                          tipoGuia:
                            doc.category === "DCTFWEB" ||
                            doc.category === "INSS" ||
                            doc.category?.toUpperCase()?.includes("INSS") ||
                            doc.title?.toUpperCase()?.includes("DCTFWEB") ||
                            doc.title?.toUpperCase()?.includes("INSS")
                              ? "DCTFWEB_INSS"
                              : doc.category === "SIMPLES_NACIONAL" ||
                                  doc.category?.toUpperCase()?.includes("SIMPLES") ||
                                  doc.title?.toUpperCase()?.includes("SIMPLES")
                                ? "DAS_SIMPLES"
                                : "OUTROS",
                          competencia: doc.competence || "01/2026",
                          status: doc.status,
                          title: doc.title,
                        }}
                        isOverdue={true}
                        onAtualizado={() => {}}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
