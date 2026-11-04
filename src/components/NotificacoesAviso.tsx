import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, Share, X, Loader2 } from "lucide-react";
import { ativarPush, estadoPush, plataformaPush, type EstadoPush } from "../lib/pushCliente";

// Aviso de notificações ao abrir o portal (área do cliente) — só no iPhone/iPad:
//   - no Safari: o iOS só entrega push para o portal instalado na tela de
//     início — mostra como instalar
//   - pela tela de início (PWA): botão "Ativar notificações" (o iOS só deixa
//     pedir a permissão a partir de um toque); negada, diz onde ligar
// Em todas as plataformas, quem já autorizou tem o registro do aparelho
// renovado em silêncio. Dispensado, o aviso volta depois de 30 dias.

const CHAVE = "notificacoesAviso_dispensadoEm";
const PAUSA_MS = 30 * 24 * 60 * 60 * 1000;

function dispensadoRecentemente(): boolean {
  try {
    const t = Number(localStorage.getItem(CHAVE));
    return t > 0 && Date.now() - t < PAUSA_MS;
  } catch {
    return false;
  }
}

export function NotificacoesAviso({ className = "" }: { className?: string }) {
  const plataforma = useMemo(plataformaPush, []);
  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const [dispensado, setDispensado] = useState(dispensadoRecentemente);
  const [ativando, setAtivando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const e = await estadoPush();
      if (!vivo) return;
      setEstado(e);
      if (e === "ativo") ativarPush(); // renova o registro (o token do app muda com o tempo)
    })();
    const aoMudar = (ev: Event) => setEstado((ev as CustomEvent<EstadoPush>).detail);
    window.addEventListener("push-estado", aoMudar);
    return () => {
      vivo = false;
      window.removeEventListener("push-estado", aoMudar);
    };
  }, [plataforma]);

  const dispensar = () => {
    try {
      localStorage.setItem(CHAVE, String(Date.now()));
    } catch {
      /* sem storage: some só nesta visita */
    }
    setDispensado(true);
  };

  const ativar = async () => {
    setAtivando(true);
    setEstado(await ativarPush());
    setAtivando(false);
  };

  const ios = plataforma === "ios-safari" || plataforma === "ios-pwa";
  if (!ios || dispensado || estado == null) return null;

  let titulo: string;
  let corpo: ReactNode;
  let botao = false;
  if (plataforma === "ios-safari") {
    titulo = "Receba os avisos no seu iPhone";
    corpo = (
      <>
        Instale o portal na tela de início: toque em <Share className="inline size-3.5 -translate-y-px" /> Compartilhar →
        “Adicionar à Tela de Início” e abra pelo ícone. Lá você ativa as notificações.
      </>
    );
  } else if (estado === "pendente") {
    titulo = "Ative as notificações";
    corpo = "Saiba na hora quando sair uma nova guia, um pagamento for confirmado ou o escritório mandar um aviso.";
    botao = true;
  } else if (estado === "negado") {
    titulo = "Notificações desligadas";
    corpo = "Para receber os avisos, ative em Ajustes do iPhone → Notificações → Vírgula.";
  } else {
    return null; // ativo ou sem suporte
  }

  return (
    <div className={`flex items-start gap-3 rounded-xl border border-brand/30 bg-brand-wash px-4 py-3.5 ${className}`}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-brand-fg">
        <Bell className="size-4" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{titulo}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{corpo}</p>
        {botao && (
          <button
            onClick={ativar}
            disabled={ativando}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            {ativando && <Loader2 className="size-3.5 animate-spin" />} Ativar notificações
          </button>
        )}
      </div>
      <button
        onClick={dispensar}
        className="-mr-1 -mt-0.5 shrink-0 p-1.5 text-faint transition-colors hover:text-muted"
        title="Agora não"
        aria-label="Dispensar aviso de notificações"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
