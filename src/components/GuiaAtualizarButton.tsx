import React, { useState } from "react";
import { RefreshCw, FileText, Send, Copy, Check, Download, AlertCircle } from "lucide-react";
import { apiFetch, openDocument } from "../lib/apiClient";

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
      if (isSupported) {
        const parts = (guia.competencia || "").split("/");
        const compStr = parts.length === 2 ? `${parts[1]}${parts[0]}` : "202605";

        const res = await apiFetch(`/api/pendencies/guia/${clienteId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipoGuia: guia.tipoGuia, competencia: compStr, documentId: guia.id }),
        }, "client");
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
         const res = await apiFetch(`/api/client/message`, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ content: msg, clientId: clienteId })
         }, "client");

         if (!res.ok) {
            throw new Error("Erro ao enviar mensagem.");
         }

         await apiFetch(`/api/client/mark-doc/${guia.id}`, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ status: "waiting_accountant" })
         }, "client");

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


  return (
    <>
      {loading && isSupported && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-8 text-center shadow-lg">
            <RefreshCw className="size-7 animate-spin text-brand" strokeWidth={1.6} />
            <div>
              <h3 className="font-serif text-lg font-normal text-ink">Recalculando a guia</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                Consultando o Integra Contador para calcular multa, juros e gerar o novo PIX.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-1 flex w-full flex-col gap-2">
        {isOverdue && !atualizada && !mensagemEnviada && (
          <button
            onClick={handleAtualizar}
            disabled={loading}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-xs font-semibold text-ink shadow-xs transition-colors hover:bg-sunken disabled:opacity-50"
            title={`Recalcular ${tipoLabel}`}
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.9} />
            {loading ? (isSupported ? "Calculando..." : "Solicitando...") : "Recalcular guia em atraso"}
          </button>
        )}

        {atualizada && novaDataVencimento && (
          <div className="flex flex-col gap-3 rounded-xl border border-brand/25 bg-brand-wash p-4">
            <div className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={2.2} />
              <p className="text-xs font-semibold text-brand-fg">
                Guia recalculada — multa e juros até o novo vencimento.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line text-center">
              {[
                { l: "Novo vencimento", v: novaDataVencimento.split("-").reverse().join("/") },
                { l: "Valor total", v: novoValor ? brl(novoValor) : "—" },
              ].map(({ l, v }) => (
                <div key={l} className="bg-surface px-2 py-2">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-faint">{l}</p>
                  <p className="mt-0.5 text-xs font-semibold text-ink tabular-nums">{v}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              {pdfPath && (
                <button
                  onClick={() => openDocument(guia.id, "view").catch((e) => setErro(e.message))}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface text-[11px] font-semibold text-ink transition-colors hover:bg-sunken"
                >
                  <Download className="size-3.5" strokeWidth={1.9} /> PDF
                </button>
              )}
              {pixCode && (
                <button
                  onClick={handleCopyPix}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand text-[11px] font-semibold text-white transition-colors hover:bg-brand-strong"
                >
                  {copied ? (
                    <><Check className="size-3.5" strokeWidth={2.2} /> Copiado</>
                  ) : (
                    <><Copy className="size-3.5" strokeWidth={1.9} /> Copiar PIX</>
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {mensagemEnviada && (
          <div className="flex items-start gap-2.5 rounded-xl border border-line bg-sunken px-3.5 py-3">
            <Send className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.9} />
            <p className="text-xs leading-relaxed text-muted">
              <span className="font-semibold text-ink">Solicitação enviada.</span> Esta guia não
              recalcula sozinha — o contador vai calcular e reenviar.
            </p>
          </div>
        )}

        {erro && (
          <div className="flex items-center gap-2 rounded-lg border border-danger/25 bg-danger-wash px-3 py-2">
            <AlertCircle className="size-4 shrink-0 text-danger" strokeWidth={1.9} />
            <span className="text-xs font-medium leading-tight text-danger">{erro}</span>
          </div>
        )}
      </div>
    </>
  );
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
