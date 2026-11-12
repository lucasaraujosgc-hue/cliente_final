// Notificações do cliente: ativar e saber o estado, em qualquer plataforma.
//   - app (Capacitor): token FCM via @capacitor-firebase/messaging (lib/native.ts)
//   - navegador / PWA: Web Push (VAPID) pelo service worker
// O aparelho é registrado em POST /api/notifications/subscribe. Quem ativa
// dispara o evento "push-estado" para as telas atualizarem.

import { apiFetch } from "./apiClient";
import { isNativeApp, nativeEnablePush, nativePushPermission } from "./native";

export type EstadoPush = "ativo" | "pendente" | "negado" | "indisponivel";

// app · iPhone/iPad no Safari (sem push: precisa instalar na tela de início) ·
// iPhone/iPad pela tela de início (PWA) · Android no navegador · demais navegadores
export type PlataformaPush = "app" | "ios-safari" | "ios-pwa" | "android-web" | "web";

export function plataformaPush(): PlataformaPush {
  if (isNativeApp()) return "app";
  const ua = navigator.userAgent;
  // iPadOS se apresenta como Mac — o toque denuncia.
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) {
    const instalado = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    return instalado ? "ios-pwa" : "ios-safari";
  }
  if (/Android/i.test(ua)) return "android-web";
  return "web";
}

const webPushSuportado = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function estadoPush(): Promise<EstadoPush> {
  if (isNativeApp()) {
    const p = await nativePushPermission();
    return p === "granted" ? "ativo" : p === "denied" ? "negado" : p === "prompt" ? "pendente" : "indisponivel";
  }
  if (!webPushSuportado()) return "indisponivel";
  const p = Notification.permission;
  return p === "granted" ? "ativo" : p === "denied" ? "negado" : "pendente";
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

const mesmaChave = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Pede a permissão (se ainda não foi dada) e registra o aparelho. No navegador
 * precisa vir de um toque do usuário (iOS exige). Já autorizado: só renova o
 * registro, em silêncio. Devolve o estado final.
 */
export async function ativarPush(): Promise<EstadoPush> {
  try {
    let fcmToken: string | null = null;
    let subscriptionObject: PushSubscription | null = null;

    if (isNativeApp()) {
      // App: token FCM único (iOS + Android).
      fcmToken = await nativeEnablePush();
    } else if (webPushSuportado()) {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") {
        const registration = await navigator.serviceWorker.ready;
        const vapidPublicKey = await (await apiFetch("/api/vapidPublicKey")).text();
        const chave = urlBase64ToUint8Array(vapidPublicKey);
        // Inscrição antiga feita com outra chave do servidor (VAPID trocada):
        // o subscribe() recusaria com InvalidStateError — refaz do zero.
        let existente = await registration.pushManager.getSubscription();
        const chaveAtual = existente?.options?.applicationServerKey;
        if (existente && chaveAtual && !mesmaChave(new Uint8Array(chaveAtual), chave)) {
          await existente.unsubscribe().catch(() => {});
          existente = null;
        }
        subscriptionObject =
          existente ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave }));
      }
    }

    if (fcmToken || subscriptionObject) {
      await apiFetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionObject, fcmToken, deviceName: navigator.userAgent }),
      });
    }
  } catch (e) {
    console.error("Falha ao ativar as notificações", e);
  }
  const estado = await estadoPush();
  window.dispatchEvent(new CustomEvent("push-estado", { detail: estado }));
  return estado;
}
