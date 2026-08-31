import { apiFetch, openDocument } from "../../lib/apiClient";
import { useState, useEffect, FormEvent } from "react";
import { UploadCloud, Folder, FileIcon, Download, CheckCircle, AlertCircle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export function ClientUploads() {
  const [docs, setDocs] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  const loadDocs = () => {
    apiFetch("/api/client/dashboard", {})
      .then((r) => r.json())
      .then((data) => setDocs(data.documents || []))
      .catch((e) => console.error("Error loading vault docs", e));
  };

  useEffect(() => loadDocs(), []);

  const handleUpload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.append("category", "upload");

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiFetch("/api/client/upload", {
        method: "POST",
        headers: {},
        body: formData,
      });
      if (!res.ok) throw new Error();
      form.reset();
      loadDocs();
      setFeedback({ type: "ok", msg: "Documento enviado para a contabilidade." });
      setTimeout(() => setFeedback(null), 5000);
    } catch {
      setFeedback({ type: "err", msg: "Não foi possível enviar. Tente novamente." });
    } finally {
      setSubmitting(false);
    }
  };

  const myUploads = docs.filter((d) => d.category === "upload");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[1.75rem] font-semibold leading-tight text-ink">Meus envios</h1>
        <p className="mt-1 text-sm text-muted">Documentos que você mandou para o escritório.</p>
      </header>

      {feedback && (
        <div
          className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-3 text-sm ${
            feedback.type === "ok"
              ? "border-brand/25 bg-brand-wash text-brand-fg"
              : "border-danger/25 bg-danger-wash text-danger"
          }`}
        >
          {feedback.type === "ok" ? (
            <CheckCircle className="size-4 shrink-0" strokeWidth={2} />
          ) : (
            <AlertCircle className="size-4 shrink-0" strokeWidth={2} />
          )}
          <span className="font-medium">{feedback.msg}</span>
        </div>
      )}

      <form
        onSubmit={handleUpload}
        className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-sm"
      >
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <UploadCloud className="size-4 text-brand" strokeWidth={1.9} /> Enviar novo documento
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-1.5">
              Descrição
            </label>
            <input
              name="title"
              type="text"
              required
              placeholder="Ex.: extrato conciliado — jan/2026"
              className="w-full rounded-lg border border-line bg-sunken px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint transition-colors focus:border-brand focus:bg-surface focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-1.5">
              Arquivo (PDF ou imagem)
            </label>
            <input
              type="file"
              name="file"
              required
              className="w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-sunken file:px-3 file:py-2 file:text-xs file:font-semibold file:text-ink hover:file:bg-line"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong disabled:opacity-50 sm:w-auto sm:px-6"
        >
          {submitting ? "Enviando…" : "Enviar para análise"}
        </button>
      </form>

      {myUploads.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface px-5 py-16 text-center shadow-sm">
          <Folder className="mx-auto size-9 text-faint" strokeWidth={1.5} />
          <p className="mt-3 font-serif text-lg font-semibold text-ink">Nenhum envio ainda</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
            Os arquivos que você enviar para o escritório aparecem aqui.
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm divide-y divide-line">
          {myUploads.map((doc) => {
            const received = doc.status === "viewed" || doc.status === "ok";
            return (
              <li key={doc.id} className="flex items-center justify-between gap-3 px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken text-faint">
                    <FileIcon className="size-[18px]" strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{doc.title}</span>
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${received ? "bg-brand-wash text-brand-fg" : "bg-warn-wash text-warn"}`}>
                        {received ? "Recebido" : "Em análise"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted tabular-nums">
                      Enviado {format(parseISO(doc.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                    </p>
                  </div>
                </div>
                {doc.fileUrl && (
                  <button
                    onClick={() => openDocument(doc.id, "download", { filename: doc.title })}
                    className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-muted transition-colors hover:bg-sunken hover:text-ink"
                    title="Baixar"
                  >
                    <Download className="size-3.5" strokeWidth={1.9} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
