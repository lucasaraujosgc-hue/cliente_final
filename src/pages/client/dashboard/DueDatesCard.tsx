import { Copy, Check, Eye, Send, Download, CircleCheck } from "lucide-react";
import { PixScannerButton } from "../../../components/PixScannerButton";
import { GuiaAtualizarButton } from "../../../components/GuiaAtualizarButton";
import { openDocument } from "../../../lib/apiClient";
import { registerGuiaInteraction } from "../../../lib/guiaInteraction";

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
  /** Doc id showing the transient "marcada como paga" confirmation. */
  paidFlashId?: string | null;
  getDocDueStatus: (doc: any) => DocDueStatus;
  onCopyCode: (docId: string, textToCopy: string) => void;
  onMarkAsPaid: (docId: string) => void;
  onReloadData: () => void;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function fmtDate(d?: string | null) {
  if (!d) return "—";
  if (d.includes("-")) {
    const [y, m, day] = d.split("T")[0].split("-");
    return `${day}/${m}/${y}`;
  }
  return d;
}

const NON_GUIA = ["contracheque", "outros", "payroll"];

const ghostBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-sunken";

export function DueDatesCard({
  docs,
  selectedCompetence,
  clientId,
  copiedId,
  paidFlashId,
  getDocDueStatus,
  onCopyCode,
  onMarkAsPaid,
  onReloadData,
}: DueDatesCardProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-4">
        <h2 className="font-serif text-lg font-normal text-ink">
          Guias de {selectedCompetence}
        </h2>
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
          Competência selecionada
        </span>
      </header>

      {docs.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <CircleCheck className="mx-auto size-8 text-brand" strokeWidth={1.6} />
          <p className="mt-3 text-sm font-semibold text-ink">
            Nada a pagar em {selectedCompetence}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
            Nenhuma guia emitida ou com vencimento cadastrado para esta
            competência. Use o seletor acima para ver outro mês.
          </p>
        </div>
      ) : (
        <ul className="space-y-3 p-4 sm:p-5">
          {docs.map((doc: any) => {
            const s = getDocDueStatus(doc);
            const paid = doc.status === "paid";
            const isGuia = !NON_GUIA.includes(doc.category?.toLowerCase());
            const value = doc.extractedData?.extractedValue;

            const accent = paid
              ? "border-l-line"
              : s.isOverdue
                ? "border-l-danger"
                : s.isSoon
                  ? "border-l-warn"
                  : "border-l-line";

            const pill = paid
              ? "bg-brand-wash text-brand-fg"
              : s.isOverdue
                ? "bg-danger-wash text-danger"
                : s.isSoon
                  ? "bg-warn-wash text-warn"
                  : "bg-sunken text-muted";

            return (
              <li
                key={doc.id}
                className={`rounded-xl border border-line border-l-[3px] ${accent} bg-surface p-4 ${paid ? "opacity-70" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-serif text-[15px] font-normal leading-snug text-ink">
                      {doc.title || "Documento"}
                    </h3>
                    <p className="mt-1 text-xs text-muted tabular-nums">
                      {[
                        doc.competence ? `Competência ${doc.competence}` : null,
                        doc.dueDate ? `vence ${fmtDate(doc.dueDate)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${pill}`}
                  >
                    {paid ? "Pago" : s.label}
                  </span>
                </div>

                {value != null && isGuia && (
                  <p className="mt-2 font-serif text-lg leading-none text-ink tabular-nums">
                    {brl(value)}
                  </p>
                )}

                {!paid &&
                  doc.paymentStatus === "PENDENTE" &&
                  doc.paymentNextCheckAt && (
                    <p className="mt-2 text-[11px] text-faint">
                      Conferência de pagamento agendada — avisamos quando for
                      identificado.
                    </p>
                  )}

                {paidFlashId === doc.id && (
                  <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-brand-fg">
                    <CircleCheck className="size-4" strokeWidth={2.2} /> Guia
                    marcada como paga
                  </p>
                )}

                {doc.status === "waiting_accountant" ? (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-sunken px-3 py-2 text-xs font-medium text-muted">
                    <Send className="size-3.5" strokeWidth={1.9} /> Aguardando o
                    contador enviar a guia
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {doc.fileUrl && (
                        <>
                          <button
                            onClick={() => {
                              registerGuiaInteraction(doc.id, "view");
                              openDocument(doc.id, "view", { filename: doc.title });
                            }}
                            className={`${ghostBtn} flex-1 sm:flex-none`}
                            title="Ver arquivo"
                          >
                            <Eye className="size-3.5" strokeWidth={1.9} /> Ver
                          </button>
                          <button
                            onClick={() =>
                              openDocument(doc.id, "download", {
                                filename: doc.title,
                              })
                            }
                            className={`${ghostBtn} w-9 px-0`}
                            title="Baixar PDF"
                          >
                            <Download className="size-3.5" strokeWidth={1.9} />
                          </button>
                        </>
                      )}

                      {doc.pixCode ? (
                        <button
                          onClick={() => {
                            registerGuiaInteraction(doc.id, "copy_pix");
                            onCopyCode(doc.id, doc.pixCode);
                          }}
                          className={`${ghostBtn} flex-1 border-brand/30 bg-brand-wash text-brand-fg hover:bg-brand-wash sm:flex-none`}
                        >
                          {copiedId === doc.id ? (
                            <>
                              <Check className="size-3.5" strokeWidth={2.2} />{" "}
                              Copiado
                            </>
                          ) : (
                            <>
                              <Copy className="size-3.5" strokeWidth={1.9} />{" "}
                              Copiar PIX
                            </>
                          )}
                        </button>
                      ) : (
                        doc.fileUrl?.toLowerCase().endsWith(".pdf") && (
                          <PixScannerButton docId={doc.id} />
                        )
                      )}
                    </div>

                    {!paid && doc.dueDate && isGuia ? (
                      <button
                        onClick={() => onMarkAsPaid(doc.id)}
                        className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand px-3.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-brand-strong sm:h-9 sm:w-auto"
                      >
                        Marcar como pago
                      </button>
                    ) : paid ? (
                      <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-brand-fg">
                        <CircleCheck className="size-4" strokeWidth={1.9} /> Pago
                      </span>
                    ) : null}

                    {!paid && (
                      <GuiaAtualizarButton
                        clienteId={clientId}
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
                          competencia:
                            doc.competence || selectedCompetence || "01/2026",
                          status: doc.status,
                          title: doc.title,
                        }}
                        isOverdue={s.isOverdue}
                        onAtualizado={() => onReloadData()}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
