import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  FileText,
  Share2,
  Plus,
  AlertTriangle,
  Building2,
  User,
  UserX,
  CheckCircle2,
  MapPin,
} from "lucide-react";
import {
  nfseApiCliente,
  centavosToBRL,
  type NfseEmitApi,
  type NfseAtividadeCliente,
  type EmitirNfseInput,
} from "../../../lib/nfse";
import { cnpjValido, cpfValido, formatarInscricao, limparInscricao } from "../../../lib/inscricao";
import { nomeArquivoNfse } from "../../../lib/filtroNotas";

const FIELD =
  "w-full rounded-lg border border-line bg-sunken px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint focus:border-brand focus:bg-surface focus:outline-none";
const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted";

// ---- local da obra / do evento / outra cidade -------------------------------
// A Receita exige o local na construção civil (E0370: CNO ou endereço) e no
// item 12 (E0390: nome, datas e endereço do evento). Nos serviços com ISS no
// local da prestação dá para informar outra cidade. O CEP define a cidade da
// prestação — e para onde vai o ISS.

interface LocalState {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string; // "Feira de Santana/BA" — confirmada pelo CEP
  cno: string;
  nome: string;
  dataInicio: string; // AAAA-MM-DD
  dataFim: string;
  outraCidade: boolean;
}
const LOCAL_VAZIO: LocalState = {
  cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "",
  cno: "", nome: "", dataInicio: "", dataFim: "", outraCidade: false,
};
type ModoLocal = "obra" | "evento" | "outra" | null;
const modoDoLocal = (a: NfseAtividadeCliente | null): ModoLocal => (a?.grupo ? a.grupo : a?.issNoLocal ? "outra" : null);
const cepDigitos = (c: string) => c.replace(/\D/g, "");
const enderecoCompleto = (l: LocalState) => !!(l.cidade && l.logradouro.trim() && l.numero.trim() && l.bairro.trim());

function localValido(modo: ModoLocal, l: LocalState): boolean {
  if (modo === "evento")
    return !!(l.nome.trim() && l.dataInicio && l.dataFim && l.dataFim >= l.dataInicio && enderecoCompleto(l));
  if (modo === "obra") return !!l.cidade && (!!l.cno.trim() || enderecoCompleto(l));
  if (modo === "outra") return !l.outraCidade || !!l.cidade;
  return true;
}

function camposDoLocal(modo: ModoLocal, l: LocalState): Pick<EmitirNfseInput, "obra" | "evento" | "localPrestacaoCep"> {
  const end = {
    cep: cepDigitos(l.cep),
    logradouro: l.logradouro.trim(),
    numero: l.numero.trim(),
    complemento: l.complemento.trim(),
    bairro: l.bairro.trim(),
  };
  if (modo === "evento") return { evento: { ...end, nome: l.nome.trim(), dataInicio: l.dataInicio, dataFim: l.dataFim } };
  if (modo === "obra") return { obra: { ...end, cno: l.cno.trim() } };
  if (modo === "outra" && l.outraCidade) return { localPrestacaoCep: end.cep };
  return {};
}

const dataBR = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");

function resumoDoLocal(modo: ModoLocal, l: LocalState): string | null {
  if (modo === "evento")
    return `Evento: ${l.nome.trim()} · ${dataBR(l.dataInicio)}${l.dataFim !== l.dataInicio ? ` a ${dataBR(l.dataFim)}` : ""} · ${l.cidade}`;
  if (modo === "obra")
    return `Obra: ${l.cno.trim() ? `CNO ${l.cno.trim()}` : `${l.logradouro.trim()}, ${l.numero.trim()}`} · ${l.cidade}`;
  if (modo === "outra" && l.outraCidade) return `Prestado em ${l.cidade}`;
  return null;
}

function LocalServico({
  modo,
  local,
  onChange,
  lookupCep,
}: {
  modo: Exclude<ModoLocal, null>;
  local: LocalState;
  onChange: (l: LocalState) => void;
  lookupCep: NfseEmitApi["lookupCep"];
}) {
  const [buscando, setBuscando] = useState(false);
  const [erroCep, setErroCep] = useState("");
  const cep = cepDigitos(local.cep);
  const set = (patch: Partial<LocalState>) => onChange({ ...local, ...patch });

  // CEP completo → cidade (e rua/bairro, se ainda em branco).
  useEffect(() => {
    if (cep.length !== 8) return;
    let vivo = true;
    setBuscando(true);
    setErroCep("");
    lookupCep(cep)
      .then((e) => {
        if (!vivo) return;
        if (!e.codigoMunicipio) throw new Error("O CEP não trouxe a cidade.");
        onChange({
          ...local,
          cidade: `${e.municipio ?? ""}/${e.uf ?? ""}`,
          logradouro: local.logradouro || e.logradouro || "",
          bairro: local.bairro || e.bairro || "",
        });
      })
      .catch((e: any) => {
        if (!vivo) return;
        setErroCep(e?.message || "Não foi possível consultar o CEP.");
        onChange({ ...local, cidade: "" });
      })
      .finally(() => vivo && setBuscando(false));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cep]);

  const campoCep = (rotulo: string) => (
    <div>
      <label className={LABEL}>{rotulo}</label>
      <div className="relative">
        <input
          className={FIELD}
          inputMode="numeric"
          placeholder="00000-000"
          value={local.cep}
          onChange={(e) => set({ cep: e.target.value, cidade: "" })}
        />
        {buscando && <Loader2 className="absolute right-3 top-3 size-4 animate-spin text-muted" />}
      </div>
      {erroCep && <p className="mt-1 text-xs text-danger">{erroCep}</p>}
      {local.cidade && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted">
          <MapPin className="size-3.5" /> {local.cidade} — o ISS desta nota é devido nesta cidade.
        </p>
      )}
    </div>
  );

  const endereco = (
    <>
      <div>
        <label className={LABEL}>Rua</label>
        <input className={FIELD} value={local.logradouro} onChange={(e) => set({ logradouro: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL}>Número</label>
          <input className={FIELD} value={local.numero} onChange={(e) => set({ numero: e.target.value })} placeholder="S/N se não houver" />
        </div>
        <div>
          <label className={LABEL}>Complemento</label>
          <input className={FIELD} value={local.complemento} onChange={(e) => set({ complemento: e.target.value })} placeholder="Opcional" />
        </div>
      </div>
      <div>
        <label className={LABEL}>Bairro</label>
        <input className={FIELD} value={local.bairro} onChange={(e) => set({ bairro: e.target.value })} />
      </div>
    </>
  );

  if (modo === "outra") {
    return (
      <div className="space-y-3 rounded-xl border border-line bg-sunken p-4">
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={local.outraCidade}
            onChange={(e) => set({ outraCidade: e.target.checked })}
          />
          <span>
            O serviço foi prestado em outra cidade
            <span className="block text-xs text-muted">Neste serviço o ISS é devido na cidade onde ele foi feito.</span>
          </span>
        </label>
        {local.outraCidade && campoCep("CEP do local onde o serviço foi prestado")}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-sunken p-4">
      <div>
        <p className="text-sm font-semibold text-ink">{modo === "evento" ? "Dados do evento" : "Dados da obra"}</p>
        <p className="text-xs text-muted">
          {modo === "evento"
            ? "A Receita exige nome, datas e local do evento nos serviços de diversão e eventos (item 12)."
            : "A Receita exige a identificação da obra na construção civil: o CNO ou o endereço."}
        </p>
      </div>
      {modo === "evento" && (
        <>
          <div>
            <label className={LABEL}>Nome do evento</label>
            <input className={FIELD} value={local.nome} onChange={(e) => set({ nome: e.target.value })} placeholder="Ex.: Show de aniversário da cidade" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL}>Início</label>
              <input
                type="date"
                className={FIELD}
                value={local.dataInicio}
                onChange={(e) => set({ dataInicio: e.target.value, dataFim: local.dataFim || e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL}>Fim</label>
              <input type="date" className={FIELD} value={local.dataFim} min={local.dataInicio || undefined} onChange={(e) => set({ dataFim: e.target.value })} />
            </div>
          </div>
          {local.dataInicio && local.dataFim && local.dataFim < local.dataInicio && (
            <p className="text-xs text-danger">A data de fim é anterior à de início.</p>
          )}
        </>
      )}
      {campoCep(modo === "evento" ? "CEP do local do evento" : "CEP da obra")}
      {modo === "obra" && (
        <div>
          <label className={LABEL}>CNO da obra (se tiver)</label>
          <input className={FIELD} value={local.cno} onChange={(e) => set({ cno: e.target.value })} placeholder="Cadastro Nacional de Obras" />
          <p className="mt-1 text-xs text-muted">Com o CNO, o endereço abaixo não é necessário.</p>
        </div>
      )}
      {(modo === "evento" || !local.cno.trim()) && endereco}
    </div>
  );
}

export interface WizardPrefill {
  // Nota duplicada: doc vazio/nulo = nota sem tomador.
  tomador: { doc: string | null; nome: string | null } | null;
  atividadeId: string | null;
  descricao: string;
  valor: number | null; // centavos
}

interface Props {
  atividades: NfseAtividadeCliente[];
  prefill?: WizardPrefill | null;
  onClose: () => void;
  // Quem emite: o próprio cliente (padrão) ou o contador por ele.
  api?: NfseEmitApi;
}

type Step = 1 | 2 | 3 | "sending" | "success" | "error" | "processando";

// Quem recebe a nota. Endereço, telefone e e-mail não são pedidos: quando a
// Sefin exige o endereço (ISS retido ou serviço 17.05.01), o servidor usa o do
// cadastro do CNPJ — ver services/nfse/tomador.ts.
type TipoTomador = "cnpj" | "cpf" | "nenhum";
const tipoDoDoc = (doc?: string | null): TipoTomador => {
  const d = limparInscricao(doc);
  return d.length === 11 ? "cpf" : d.length === 14 ? "cnpj" : "nenhum";
};

export function EmitWizard({ atividades, prefill, onClose, api = nfseApiCliente }: Props) {
  const [tipo, setTipo] = useState<TipoTomador>(prefill ? tipoDoDoc(prefill.tomador?.doc) : "cnpj");
  const [doc, setDoc] = useState(prefill?.tomador?.doc ? formatarInscricao(prefill.tomador.doc) : "");
  const [nome, setNome] = useState(prefill?.tomador?.nome ?? "");
  // CNPJ: razão social vinda da consulta (só confirmar). Falhou → digita.
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [municipio, setMunicipio] = useState("");
  const docLimpo = limparInscricao(doc);
  const docValido = tipo === "cnpj" ? cnpjValido(docLimpo) : tipo === "cpf" ? cpfValido(docLimpo) : true;
  const tomadorOk = tipo === "nenhum" || (docValido && !!nome.trim() && !looking);
  // Nota duplicada já completa vai direto ao valor.
  const [step, setStep] = useState<Step>(prefill && (tipo === "nenhum" || (docValido && !!nome.trim())) ? 3 : 1);

  // CNPJ completo e válido → busca a razão social para confirmar na tela.
  useEffect(() => {
    if (tipo !== "cnpj" || !cnpjValido(docLimpo)) return;
    if (prefill?.tomador?.nome && limparInscricao(prefill.tomador.doc) === docLimpo) return; // duplicada
    let vivo = true;
    setLooking(true);
    setLookupError("");
    setNome("");
    setMunicipio("");
    api
      .lookupCnpj(docLimpo)
      .then((t) => {
        if (!vivo) return;
        setNome(t.razaoSocial || "");
        setMunicipio(t.endereco?.municipio ? `${t.endereco.municipio}/${t.endereco.uf ?? ""}` : "");
        if (!t.razaoSocial) setLookupError("A consulta não trouxe a razão social.");
      })
      .catch((e: any) => vivo && setLookupError(e?.message || "Não foi possível consultar o CNPJ."))
      .finally(() => vivo && setLooking(false));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, docLimpo]);

  const trocarTipo = (t: TipoTomador) => {
    setTipo(t);
    setDoc("");
    setNome("");
    setLookupError("");
    setMunicipio("");
  };

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
  const [local, setLocal] = useState<LocalState>(LOCAL_VAZIO);
  const modoLocal = modoDoLocal(atividade);

  const valorCentavos = useMemo(() => {
    const n = Number(valorStr.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }, [valorStr]);

  const [syncing, setSyncing] = useState(false);

  const submit = async () => {
    setStep("sending");
    const r = await api.emitir({
      atividadeId,
      tomador: tipo === "nenhum" ? null : { doc: docLimpo, nome: nome.trim() },
      descricao,
      valor: valorCentavos,
      ...camposDoLocal(modoLocal, local),
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
    const s = await api.sincronizar(result.id).catch(() => null);
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
    trocarTipo("cnpj");
    setAtividadeId("");
    setDescricao("");
    setValorStr("");
    setKeepValue(false);
    setLocal(LOCAL_VAZIO);
    setResult(null);
  };

  // Nome legível do PDF: "NFS-e 43 - TOMADOR - 02-11-2026".
  const nomeDoPdf = () =>
    nomeArquivoNfse({
      numeroNota: result?.numeroNota ?? null,
      tomadorNome: tipo === "nenhum" ? null : nome.trim(),
      tomadorDoc: tipo === "nenhum" ? null : docLimpo,
      dataEmissao: new Date().toISOString(),
    });

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
          </p>
          {/* A chave tem 50 dígitos sem espaço: quebra em qualquer ponto para não
              estourar a largura no celular. */}
          {result?.chaveAcesso && (
            <p className="mx-auto mt-1 max-w-sm break-all font-mono text-[11px] leading-relaxed text-faint">
              chave {result.chaveAcesso}
            </p>
          )}
        </div>
        {shareMsg && <p className="text-xs text-muted">{shareMsg}</p>}
        <div className="mx-auto flex max-w-sm flex-col gap-2">
          <button
            onClick={() => result?.id && api.verDanfse(result.id, nomeDoPdf())}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            <FileText className="size-4" /> Visualizar a nota
          </button>
          <button
            onClick={async () => {
              if (!result?.id) return;
              const r = await api.compartilharDanfse(result.id, nomeDoPdf()).catch(() => null);
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
    const validacao = !result?.codigo && result?.error === "Dados inválidos.";
    return (
      <div className="space-y-5 py-6">
        <Header title={validacao ? "Revise os dados da nota" : "Nota rejeitada"} onBack={() => setStep(3)} />
        <div className="flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger-wash p-5">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div>
            <p className="text-sm font-semibold text-ink">
              {result?.codigo
                ? `A Sefin Nacional recusou a nota · código ${result.codigo}`
                : validacao
                  ? "Confira os campos abaixo"
                  : "A Sefin Nacional recusou a nota"}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{result?.motivo || result?.error}</p>
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
    const OPCOES: { v: TipoTomador; rotulo: string; Icone: typeof Building2 }[] = [
      { v: "cnpj", rotulo: "CNPJ", Icone: Building2 },
      { v: "cpf", rotulo: "CPF", Icone: User },
      { v: "nenhum", rotulo: "Sem tomador", Icone: UserX },
    ];
    const completo = tipo === "cnpj" ? docLimpo.length === 14 : docLimpo.length === 11;
    return (
      <div>
        <Header title="Para quem é a nota?" />
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {OPCOES.map(({ v, rotulo, Icone }) => (
              <button
                key={v}
                onClick={() => trocarTipo(v)}
                className={
                  "flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-sm font-semibold transition-colors " +
                  (tipo === v ? "border-brand bg-brand-wash text-brand-fg" : "border-line bg-surface text-ink hover:bg-sunken")
                }
              >
                <Icone className="size-5" strokeWidth={1.8} />
                {rotulo}
              </button>
            ))}
          </div>

          {tipo === "nenhum" ? (
            <div className="rounded-xl border border-line bg-sunken p-4 text-sm text-muted">
              <p className="font-semibold text-ink">Nota sem identificação do tomador</p>
              <p className="mt-1">
                Para consumidor final que não quis se identificar. Em algumas prefeituras uma nota sem tomador não pode ser
                substituída depois — só cancelada.
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className={LABEL}>{tipo === "cnpj" ? "CNPJ do tomador" : "CPF do tomador"}</label>
                <div className="relative">
                  <input
                    className={FIELD}
                    inputMode={tipo === "cpf" ? "numeric" : "text"}
                    autoCapitalize="characters"
                    placeholder={tipo === "cnpj" ? "00.000.000/0000-00" : "000.000.000-00"}
                    value={doc}
                    onChange={(e) => setDoc(e.target.value.toUpperCase())}
                    onBlur={() => completo && setDoc(formatarInscricao(docLimpo))}
                    autoFocus
                  />
                  {looking && <Loader2 className="absolute right-3 top-3 size-4 animate-spin text-muted" />}
                </div>
                {completo && !docValido && (
                  <p className="mt-1.5 text-xs text-danger">{tipo === "cnpj" ? "CNPJ" : "CPF"} inválido — confira os números.</p>
                )}
              </div>

              {tipo === "cnpj" && docValido && !looking && nome && !lookupError && (
                <div className="flex items-start gap-3 rounded-xl border border-brand/30 bg-brand-wash p-4">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-fg" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Confira o tomador</p>
                    <p className="font-semibold text-ink">{nome}</p>
                    {municipio && <p className="text-xs text-muted">{municipio}</p>}
                  </div>
                </div>
              )}

              {tipo === "cnpj" && docValido && !looking && lookupError && (
                <div>
                  <p className="mb-2 text-xs text-muted">{lookupError} Digite a razão social do tomador:</p>
                  <input className={FIELD} placeholder="Razão social" value={nome} onChange={(e) => setNome(e.target.value)} />
                </div>
              )}

              {tipo === "cpf" && (
                <div>
                  <label className={LABEL}>Nome do tomador</label>
                  <input className={FIELD} placeholder="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} />
                  <p className="mt-1 text-xs text-muted">Obrigatório na nota quando o tomador é identificado pelo CPF.</p>
                </div>
              )}
            </>
          )}

          <button
            onClick={() => setStep(2)}
            disabled={!tomadorOk}
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
            {atividades.map((a) => {
              // ISS retido / 17.05.01: a nota exige o tomador com CNPJ.
              const bloqueada = !!a.exigeTomadorCnpj && tipo !== "cnpj";
              return (
                <button
                  key={a.id}
                  disabled={bloqueada}
                  onClick={() => {
                    setAtividadeId(a.id);
                    // Troca a descrição junto com a atividade, a menos que já tenha sido escrita à mão.
                    if (!descricao.trim() || descricao === atividade?.descricaoPadrao) setDescricao(a.descricaoPadrao || "");
                  }}
                  className={
                    "w-full rounded-xl border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
                    (atividadeId === a.id && !bloqueada
                      ? "border-brand bg-brand-wash"
                      : "border-line bg-surface hover:bg-sunken")
                  }
                >
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span className="font-mono text-xs text-brand-fg">{a.itemListaServico}</span>
                    {a.nome}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    ISS {a.aliquotaIss}%{a.issRetido ? " · retido" : ""}
                    {bloqueada ? " · exige tomador com CNPJ" : ""}
                  </p>
                </button>
              );
            })}
          </div>

          <div>
            <label className={LABEL}>Descrição da nota (obrigatória)</label>
            <textarea
              className={FIELD + " min-h-[90px]" + (atividade && !descricao.trim() ? " border-danger" : "")}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descreva o serviço prestado"
            />
            {atividade && !atividade.descricaoPadrao?.trim() && (
              <p className="mt-1 text-xs text-muted">
                Esta atividade não tem descrição padrão — escreva o que foi prestado ao tomador.
              </p>
            )}
            {atividade && !descricao.trim() && <p className="mt-1 text-xs text-danger">Preencha a descrição para continuar.</p>}
          </div>

          {modoLocal && <LocalServico modo={modoLocal} local={local} onChange={setLocal} lookupCep={api.lookupCep} />}

          <button
            onClick={() => setStep(3)}
            disabled={
              !atividadeId ||
              !descricao.trim() ||
              (!!atividade?.exigeTomadorCnpj && tipo !== "cnpj") ||
              !localValido(modoLocal, local)
            }
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
          {tipo === "nenhum" ? (
            <p className="font-semibold text-ink">Sem tomador (consumidor não identificado)</p>
          ) : (
            <>
              <p className="font-semibold text-ink">{nome}</p>
              <p className="text-xs text-muted">
                {tipo === "cnpj" ? "CNPJ" : "CPF"} {formatarInscricao(docLimpo)}
              </p>
            </>
          )}
          <p className="mt-2 text-xs text-muted">{atividade?.nome} — {descricao}</p>
          {resumoDoLocal(modoLocal, local) && <p className="mt-1 text-xs text-muted">{resumoDoLocal(modoLocal, local)}</p>}
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
