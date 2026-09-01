import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Search,
  Check,
  Loader2,
  FileText,
  Share2,
  Plus,
  AlertTriangle,
} from "lucide-react";
import {
  lookupCnpjTomador,
  emitirNfse,
  sincronizarEmissao,
  viewDanfse,
  shareDanfse,
  centavosToBRL,
  type NfseAtividadeCliente,
  type NfseEndereco,
} from "../../../lib/nfse";
import { formatCnpj, normalizeCnpj } from "../../../lib/cnpj";

const FIELD =
  "w-full rounded-lg border border-line bg-sunken px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint focus:border-brand focus:bg-surface focus:outline-none";
const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted";

export interface WizardPrefill {
  tomador: {
    doc: string;
    nome: string;
    email?: string | null;
    telefone?: string | null;
    endereco?: NfseEndereco | null;
  };
  atividadeId: string | null;
  descricao: string;
  valor: number | null; // centavos
}

interface Props {
  atividades: NfseAtividadeCliente[];
  prefill?: WizardPrefill | null;
  onClose: () => void;
}

type Step = 1 | 2 | 3 | "sending" | "success" | "error" | "processando";

export function EmitWizard({ atividades, prefill, onClose }: Props) {
  const [step, setStep] = useState<Step>(prefill ? 3 : 1);
  const [cnpj, setCnpj] = useState(prefill?.tomador.doc ? formatCnpj(prefill.tomador.doc) : "");
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState("");

  const [tomador, setTomador] = useState({
    doc: prefill?.tomador.doc ?? "",
    nome: prefill?.tomador.nome ?? "",
    email: prefill?.tomador.email ?? "",
    telefone: prefill?.tomador.telefone ?? "",
    endereco: (prefill?.tomador.endereco ?? null) as NfseEndereco | null,
  });

  const [atividadeId, setAtividadeId] = useState(prefill?.atividadeId ?? "");
  const [descricao, setDescricao] = useState(prefill?.descricao ?? "");
  const [valorStr, setValorStr] = useState(
    prefill?.valor ? (prefill.valor / 100).toFixed(2).replace(".", ",") : "",
  );
  const [keepValue, setKeepValue] = useState(!!prefill?.valor);

  const [result, setResult] = useState<{
    id?: string;
    numeroNota?: string | null;
    chaveAcesso?: string | null;
    error?: string;
    codigo?: string | null;
    motivo?: string | null;
  } | null>(null);
  const [shareMsg, setShareMsg] = useState("");

  const atividade = useMemo(
    () => atividades.find((a) => a.id === atividadeId) || null,
    [atividades, atividadeId],
  );

  const valorCentavos = useMemo(() => {
    const n = Number(valorStr.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }, [valorStr]);

  const buscarCnpj = async () => {
    setLookupError("");
    setLooking(true);
    try {
      const t = await lookupCnpjTomador(cnpj);
      setTomador({
        doc: t.cnpj,
        nome: t.razaoSocial,
        email: t.email ?? "",
        telefone: t.telefone ?? "",
        endereco: t.endereco,
      });
    } catch (e: any) {
      setLookupError(e.message || "Não foi possível consultar o CNPJ.");
      setTomador((s) => ({ ...s, doc: normalizeCnpj(cnpj) }));
    } finally {
      setLooking(false);
    }
  };

  const [syncing, setSyncing] = useState(false);

  const submit = async () => {
    setStep("sending");
    const r = await emitirNfse({
      atividadeId,
      tomador: {
        doc: tomador.doc,
        nome: tomador.nome,
        email: tomador.email || undefined,
        telefone: tomador.telefone || undefined,
        endereco: tomador.endereco || undefined,
      },
      descricao,
      valor: valorCentavos,
    });
    if (r.ok) {
      setResult({ id: r.id, numeroNota: r.numeroNota, chaveAcesso: r.chaveAcesso });
      setStep("success");
    } else if (r.processando) {
      setResult({ id: r.id, motivo: r.motivo });
      setStep("processando");
    } else {
      setResult({ error: r.error, codigo: r.codigo, motivo: r.motivo });
      setStep("error");
    }
  };

  const verificarProcessamento = async () => {
    if (!result?.id) return;
    setSyncing(true);
    const s = await sincronizarEmissao(result.id).catch(() => null);
    setSyncing(false);
    if (!s) return;
    if (s.status === "emitida") {
      setResult({ id: result.id, numeroNota: s.numeroNota ?? undefined, chaveAcesso: s.chaveAcesso ?? undefined });
      setStep("success");
    } else if (s.status === "rejeitada") {
      setResult({ id: result.id, motivo: s.rejeicaoMotivo || "A nota foi rejeitada pelo Sefin Nacional." });
      setStep("error");
    }
  };

  const reset = () => {
    setStep(1);
    setCnpj("");
    setTomador({ doc: "", nome: "", email: "", telefone: "", endereco: null });
    setAtividadeId("");
    setDescricao("");
    setValorStr("");
    setKeepValue(false);
    setResult(null);
  };

  // ---- shells --------------------------------------------------------------

  const Header = ({ title, onBack }: { title: string; onBack?: () => void }) => (
    <div className="mb-5 flex items-center gap-3">
      <button
        onClick={onBack || onClose}
        className="grid size-9 place-items-center rounded-lg border border-line bg-surface text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" />
      </button>
      <h2 className="font-serif text-lg font-semibold text-ink">{title}</h2>
      {typeof step === "number" && (
        <span className="ml-auto text-xs font-semibold text-faint">Passo {step} de 3</span>
      )}
    </div>
  );

  if (step === "sending") {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-muted">
        <Loader2 className="size-7 animate-spin text-brand" />
        <p className="text-sm font-semibold text-ink">Emitindo a nota…</p>
        <p className="text-xs">Assinando e enviando à Sefin Nacional.</p>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="space-y-6 py-6 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-ok-wash text-brand-fg">
          <Check className="size-7" strokeWidth={2.4} />
        </div>
        <div>
          <h2 className="font-serif text-xl font-semibold text-ink">Nota emitida com sucesso</h2>
          <p className="mt-1 text-sm text-muted">
            {result?.numeroNota ? `Nota nº ${result.numeroNota}` : "Nota registrada"}
            {result?.chaveAcesso ? ` · chave ${result.chaveAcesso}` : ""}
          </p>
        </div>
        {shareMsg && <p className="text-xs text-muted">{shareMsg}</p>}
        <div className="mx-auto flex max-w-sm flex-col gap-2">
          <button
            onClick={() => result?.id && viewDanfse(result.id, result.numeroNota)}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            <FileText className="size-4" /> Visualizar a nota
          </button>
          <button
            onClick={async () => {
              if (!result?.id) return;
              const r = await shareDanfse(result.id, result.numeroNota).catch(() => null);
              setShareMsg(r === "downloaded" ? "PDF baixado." : r === "shared" ? "" : "Falha ao compartilhar.");
            }}
            className="flex items-center justify-center gap-2 rounded-lg border border-line bg-surface py-3 text-sm font-semibold text-ink hover:bg-sunken"
          >
            <Share2 className="size-4" /> Compartilhar a nota
          </button>
          <button
            onClick={reset}
            className="flex items-center justify-center gap-2 rounded-lg border border-line bg-surface py-3 text-sm font-semibold text-ink hover:bg-sunken"
          >
            <Plus className="size-4" /> Emitir uma nova nota
          </button>
          <button onClick={onClose} className="mt-1 text-xs font-semibold text-muted hover:text-ink">
            Voltar às notas emitidas
          </button>
        </div>
      </div>
    );
  }

  if (step === "processando") {
    return (
      <div className="space-y-5 py-6">
        <Header title="Nota em processamento" onBack={onClose} />
        <div className="flex items-start gap-3 rounded-2xl border border-warn/25 bg-warn-wash p-5">
          <Loader2 className="mt-0.5 size-5 shrink-0 text-warn animate-spin" />
          <div>
            <p className="text-sm font-semibold text-ink">A nota foi enviada ao Sefin Nacional</p>
            <p className="mt-1 text-sm text-muted">
              {result?.motivo ||
                "O Sefin ainda não confirmou. A nota aparecerá em “Notas emitidas” assim que for confirmada — não emita de novo."}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={verificarProcessamento}
            disabled={syncing}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
          >
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Verificar agora
          </button>
          <button onClick={onClose} className="rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink">
            Fechar
          </button>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="space-y-5 py-6">
        <Header title="Nota rejeitada" onBack={() => setStep(3)} />
        <div className="flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger-wash p-5">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div>
            <p className="text-sm font-semibold text-ink">
              {result?.codigo ? `Código ${result.codigo}` : "A Sefin Nacional recusou a nota"}
            </p>
            <p className="mt-1 text-sm text-muted">{result?.motivo || result?.error}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setStep(3)}
            className="flex-1 rounded-lg bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Revisar e tentar de novo
          </button>
          <button onClick={onClose} className="rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink">
            Sair
          </button>
        </div>
      </div>
    );
  }

  // ---- step 1: tomador ----------------------------------------------------
  if (step === 1) {
    return (
      <div>
        <Header title="Para quem é a nota?" />
        <div className="space-y-4">
          <div>
            <label className={LABEL}>CNPJ do tomador</label>
            <div className="flex gap-2">
              <input
                className={FIELD}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
              />
              <button
                onClick={buscarCnpj}
                disabled={looking || normalizeCnpj(cnpj).length !== 14}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-semibold text-ground disabled:opacity-40"
              >
                {looking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                Buscar
              </button>
            </div>
            {lookupError && <p className="mt-1.5 text-xs text-danger">{lookupError} Você pode preencher abaixo.</p>}
          </div>

          {(tomador.nome || tomador.doc) && (
            <div className="space-y-3 rounded-xl border border-line bg-sunken p-4">
              <div>
                <label className={LABEL}>Razão social</label>
                <input className={FIELD} value={tomador.nome} onChange={(e) => setTomador({ ...tomador, nome: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={LABEL}>E-mail</label>
                  <input className={FIELD} value={tomador.email} onChange={(e) => setTomador({ ...tomador, email: e.target.value })} />
                </div>
                <div>
                  <label className={LABEL}>Telefone</label>
                  <input className={FIELD} value={tomador.telefone} onChange={(e) => setTomador({ ...tomador, telefone: e.target.value })} />
                </div>
              </div>
              {tomador.endereco?.municipio && (
                <p className="text-xs text-muted">
                  {[tomador.endereco.logradouro, tomador.endereco.numero, tomador.endereco.bairro]
                    .filter(Boolean)
                    .join(", ")}{" "}
                  — {tomador.endereco.municipio}/{tomador.endereco.uf}
                </p>
              )}
            </div>
          )}

          <button
            onClick={() => setStep(2)}
            disabled={!tomador.nome || normalizeCnpj(tomador.doc || cnpj).length !== 14}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
          >
            Avançar <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  // ---- step 2: atividade + descrição ------------------------------------
  if (step === 2) {
    return (
      <div>
        <Header title="Qual serviço foi prestado?" onBack={() => setStep(1)} />
        <div className="space-y-4">
          <div className="space-y-2">
            {atividades.length === 0 && (
              <p className="rounded-lg border border-warn/25 bg-warn-wash p-3 text-sm text-muted">
                Nenhuma atividade configurada. Fale com a contabilidade.
              </p>
            )}
            {atividades.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setAtividadeId(a.id);
                  if (!descricao) setDescricao(a.descricaoPadrao);
                }}
                className={
                  "w-full rounded-xl border p-3.5 text-left transition-colors " +
                  (atividadeId === a.id
                    ? "border-brand bg-brand-wash"
                    : "border-line bg-surface hover:bg-sunken")
                }
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <span className="font-mono text-xs text-brand-fg">{a.itemListaServico}</span>
                  {a.nome}
                </p>
                <p className="mt-0.5 text-xs text-muted">ISS {a.aliquotaIss}%{a.issRetido ? " · retido" : ""}</p>
              </button>
            ))}
          </div>

          <div>
            <label className={LABEL}>Descrição da nota</label>
            <textarea
              className={FIELD + " min-h-[90px]"}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="O que foi prestado ao tomador"
            />
          </div>

          <button
            onClick={() => setStep(3)}
            disabled={!atividadeId || !descricao.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
          >
            Avançar <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  // ---- step 3: valor ---------------------------------------------------
  return (
    <div>
      <Header title="Valor da nota" onBack={() => setStep(prefill ? 2 : 2)} />
      <div className="space-y-4">
        <div className="rounded-xl border border-line bg-sunken p-4 text-sm">
          <p className="font-semibold text-ink">{tomador.nome}</p>
          <p className="text-xs text-muted">{formatCnpj(tomador.doc)}</p>
          <p className="mt-2 text-xs text-muted">{atividade?.nome} — {descricao}</p>
        </div>

        {prefill?.valor ? (
          <div className="space-y-2 rounded-xl border border-line bg-surface p-4">
            <p className="text-sm text-muted">
              Manter o valor da nota duplicada ({centavosToBRL(prefill.valor)})?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setKeepValue(true)}
                className={
                  "flex-1 rounded-lg py-2 text-sm font-semibold " +
                  (keepValue ? "bg-brand text-white" : "border border-line bg-surface text-ink")
                }
              >
                Manter
              </button>
              <button
                onClick={() => {
                  setKeepValue(false);
                  setValorStr("");
                }}
                className={
                  "flex-1 rounded-lg py-2 text-sm font-semibold " +
                  (!keepValue ? "bg-brand text-white" : "border border-line bg-surface text-ink")
                }
              >
                Alterar
              </button>
            </div>
          </div>
        ) : null}

        {(!prefill?.valor || !keepValue) && (
          <div>
            <label className={LABEL}>Valor dos serviços (R$)</label>
            <input
              className={FIELD + " text-lg font-semibold"}
              inputMode="decimal"
              placeholder="0,00"
              value={valorStr}
              onChange={(e) => setValorStr(e.target.value)}
              autoFocus
            />
          </div>
        )}

        <div className="rounded-lg bg-sunken p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Total da nota</span>
            <span className="font-semibold text-ink tabular-nums">{centavosToBRL(valorCentavos)}</span>
          </div>
        </div>

        <button
          onClick={submit}
          disabled={valorCentavos <= 0}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
        >
          <Check className="size-4" /> Concluir e emitir
        </button>
      </div>
    </div>
  );
}
