/// <reference types="@capacitor-firebase/messaging" />
import type { CapacitorConfig } from "@capacitor/cli";

// App nativo (Capacitor) — SOMENTE o portal do cliente. O contador continua no
// navegador. O bundle web é o mesmo SPA de src/, gerado por `npm run build:mobile`
// em ./www; a API é chamada por HTTPS em cliente.virgulacontabil.com.br (ver
// src/lib/apiClient.ts getApiUrl + o CORS/CSP em server.ts).
//
// appId é PERMANENTE depois da 1ª publicação nas lojas — confirme antes de subir.
const config: CapacitorConfig = {
  appId: "br.com.virgulacontabil.cliente",
  appName: "Portal do Cliente",
  webDir: "www",
  // Sem `server.url`: os assets vão embutidos no app (a App Store implica menos
  // com "wrapper de site" quando o conteúdo é local). A navegação para o site
  // fica bloqueada — só a API é consumida via fetch.
  ios: {
    scheme: "App",
    contentInset: "always",
    backgroundColor: "#0f172a",
  },
  android: {
    // androidScheme 'https' (padrão do Capacitor) → origin https://localhost
    // Fundo do WebView enquanto carrega = fundo da splash e do app (#f8fafc),
    // para a abertura não piscar escuro.
    backgroundColor: "#f8fafc",
  },
  plugins: {
    // Push via FCM (iOS + Android). Ver docs/MOBILE_BUILD.md p/ o setup Firebase.
    FirebaseMessaging: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    SplashScreen: {
      launchShowDuration: 700,
      launchAutoHide: true,
      // Android: a splash vem do tema (res/values*/styles.xml, gerada de
      // favicon.html + exportar-logo.html); esta cor vale no fallback legado.
      backgroundColor: "#f8fafc",
      showSpinner: false,
    },
  },
  // Se o Xcode reclamar de colisão de identidade de pacote SwiftPM ao resolver
  // o firebase-ios-sdk (capawesome-team/capacitor-firebase#959), habilite:
  //   experimental: { ios: { spm: { packageOptions: {
  //     "@capacitor-firebase/messaging": { symlink: true } } } } }
  // (o symlink só é criável no macOS/Linux — no Windows o `cap sync` dá EPERM).
};

export default config;
