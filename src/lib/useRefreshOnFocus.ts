import { useEffect, useRef } from "react";

// Recarrega os dados quando o cliente volta para a aba / reabre o app.
//
// O portal é um SPA sem websocket: quando o contador dá baixa numa guia, a
// tela do cliente só mudava se ele apertasse "Atualizar" ou recarregasse a
// página — então uma guia já paga continuava aparecendo como pendente por
// tempo indefinido. Aqui o dado se refaz sozinho no momento em que ele olha.
//
// Throttle porque o evento dispara em qualquer alt-tab: sem ele, trocar de
// janela viraria uma rajada de requests.
const DEFAULT_MIN_INTERVAL_MS = 30_000;

export function useRefreshOnFocus(
  refresh: () => void | Promise<unknown>,
  { minIntervalMs = DEFAULT_MIN_INTERVAL_MS, enabled = true }: {
    minIntervalMs?: number;
    enabled?: boolean;
  } = {},
) {
  // Guarda o callback numa ref para não re-registrar o listener a cada render
  // (o chamador quase sempre passa uma função nova).
  const cb = useRef(refresh);
  cb.current = refresh;
  const lastRun = useRef(Date.now());

  useEffect(() => {
    if (!enabled) return;

    const maybeRefresh = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRun.current < minIntervalMs) return;
      lastRun.current = now;
      void cb.current();
    };

    document.addEventListener("visibilitychange", maybeRefresh);
    window.addEventListener("focus", maybeRefresh);

    // No app nativo o visibilitychange do WebView nem sempre dispara ao voltar
    // do background; o @capacitor/app avisa direito.
    let remove: (() => void) | undefined;
    void (async () => {
      try {
        const { isNativeApp } = await import("./native");
        if (!isNativeApp()) return;
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) maybeRefresh();
        });
        remove = () => void handle.remove();
      } catch {
        /* sem plugin: os listeners web já cobrem */
      }
    })();

    return () => {
      document.removeEventListener("visibilitychange", maybeRefresh);
      window.removeEventListener("focus", maybeRefresh);
      remove?.();
    };
  }, [minIntervalMs, enabled]);
}
