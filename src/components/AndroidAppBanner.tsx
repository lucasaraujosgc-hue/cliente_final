import { useState } from "react";
import { Smartphone, X } from "lucide-react";
import { isNativeApp } from "../lib/native";

// Aviso "o app já está no Google Play" para quem abre o portal pelo navegador
// de um celular Android. Não aparece dentro do próprio app (Capacitor) nem em
// outros aparelhos. Dispensado, volta só depois de 30 dias.

export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=br.com.virgulacontabil.cliente";

const CHAVE = "androidAppBanner_dispensadoEm";
const PAUSA_MS = 30 * 24 * 60 * 60 * 1000;

export function ehAndroidNoNavegador(): boolean {
  try {
    return /Android/i.test(navigator.userAgent) && !isNativeApp();
  } catch {
    return false;
  }
}

function dispensadoRecentemente(): boolean {
  try {
    const t = Number(localStorage.getItem(CHAVE));
    return t > 0 && Date.now() - t < PAUSA_MS;
  } catch {
    return false;
  }
}

export function AndroidAppBanner({ className = "" }: { className?: string }) {
  const [visivel, setVisivel] = useState(() => ehAndroidNoNavegador() && !dispensadoRecentemente());
  if (!visivel) return null;

  const dispensar = () => {
    try {
      localStorage.setItem(CHAVE, String(Date.now()));
    } catch {
      /* sem storage: some só nesta visita */
    }
    setVisivel(false);
  };

  return (
    <div className={`flex items-start gap-3 rounded-xl border border-brand/30 bg-brand-wash px-4 py-3.5 ${className}`}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-brand-fg">
        <Smartphone className="size-4" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">O app do portal já está disponível</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Baixe o app Vírgula Contábil no Google Play e acesse suas guias e documentos direto do celular.
        </p>
        <a
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 inline-flex items-center rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-strong"
        >
          Baixar no Google Play
        </a>
      </div>
      <button
        onClick={dispensar}
        className="-mr-1 -mt-0.5 shrink-0 p-1.5 text-faint transition-colors hover:text-muted"
        title="Agora não"
        aria-label="Dispensar aviso do app"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
