// Ponte com o shell nativo (Capacitor). Tudo aqui é no-op no navegador/PWA —
// as funções checam `Capacitor.isNativePlatform()` antes de tocar em plugin.
//
// Só é usado no app do CLIENTE (o contador roda no navegador).

import { Capacitor } from "@capacitor/core";

export const isNativeApp = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

export const nativePlatform = (): "ios" | "android" | "web" => {
  try {
    const p = Capacitor.getPlatform();
    return p === "ios" || p === "android" ? p : "web";
  } catch {
    return "web";
  }
};

// Chamado uma vez no boot (src/main.tsx). Configura status bar, esconde a splash
// e liga o botão voltar do Android ao histórico do router.
export async function initNativeShell(): Promise<void> {
  if (!isNativeApp()) return;

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // A UI segue o tema do sistema; deixamos a status bar em modo automático e
    // sem sobrepor o conteúdo (o <body> já tem padding de safe-area).
    await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    await StatusBar.setStyle({ style: Style.Default }).catch(() => {});
  } catch {
    /* plugin ausente */
  }

  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide().catch(() => {});
  } catch {
    /* ignore */
  }

  try {
    const { App } = await import("@capacitor/app");
    // Botão voltar do Android: volta no histórico; na raiz, minimiza o app.
    void App.addListener("backButton", ({ canGoBack }) => {
      // Se há um modal/drawer aberto, deixa a página tratar (evento próprio).
      if (window.dispatchEvent(new CustomEvent("native-back", { cancelable: true })) === false) {
        return;
      }
      if (canGoBack && window.history.length > 1) {
        window.history.back();
      } else {
        void App.exitApp().catch(() => {});
      }
    });
  } catch {
    /* ignore */
  }
  // @capacitor/keyboard só de estar instalado já ajusta o viewport quando o
  // teclado abre — sem config extra.
}

// --- Push (FCM nativo) ---------------------------------------------------
//
// No app usamos @capacitor-firebase/messaging: um token FCM único p/ iOS e
// Android, que é o que o backend (firebase-admin) espera. O push web (VAPID)
// continua no fluxo do Dashboard. Todas as funções abaixo são no-op no browser.

type PermState = "granted" | "denied" | "prompt" | "unsupported";

export async function nativePushPermission(): Promise<PermState> {
  if (!isNativeApp()) return "unsupported";
  try {
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
    const { receive } = await FirebaseMessaging.checkPermissions();
    return receive === "granted" || receive === "denied" || receive === "prompt"
      ? receive
      : "prompt";
  } catch {
    return "unsupported";
  }
}

// Pede permissão (se preciso), registra e devolve o token FCM. null = negado/erro.
export async function nativeEnablePush(): Promise<string | null> {
  if (!isNativeApp()) return null;
  try {
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
    let { receive } = await FirebaseMessaging.checkPermissions();
    if (receive === "prompt" || receive === "prompt-with-rationale") {
      ({ receive } = await FirebaseMessaging.requestPermissions());
    }
    if (receive !== "granted") return null;
    const { token } = await FirebaseMessaging.getToken();
    return token || null;
  } catch (e) {
    console.error("nativeEnablePush falhou", e);
    return null;
  }
}

// Abre um arquivo já baixado (Blob) no visualizador nativo via folha de
// compartilhamento. No navegador cai no fluxo web (o chamador decide).
export async function shareNativeBlob(
  blob: Blob,
  filename: string,
): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const base64 = await blobToBase64(blob);
    const safeName = filename.replace(/[^\w.\-]+/g, "_") || "documento";
    const written = await Filesystem.writeFile({
      path: safeName,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({ url: written.uri, title: filename });
    return true;
  } catch {
    return false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const s = String(r.result || "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.readAsDataURL(blob);
  });
}
