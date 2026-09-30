// Stub de `firebase/messaging` para o build web.
//
// @capacitor-firebase/messaging traz uma implementação WEB que faz
// `import ... from "firebase/messaging"`. Nós NÃO usamos push via Firebase no
// navegador (o PWA usa Web Push / VAPID) e todas as chamadas do plugin são
// guardadas por `isNativeApp()`, então essa implementação web nunca roda.
//
// Sem o pacote `firebase` instalado o Rollup quebra ao resolver esse import.
// O vite.config.ts aponta "firebase/messaging" e "firebase/app" para cá.

export function getMessaging(): never {
  throw new Error("firebase/messaging não está disponível no navegador (use o app).");
}
export function getToken(): never {
  throw new Error("firebase/messaging não está disponível no navegador (use o app).");
}
export function deleteToken(): Promise<boolean> {
  return Promise.resolve(false);
}
export function onMessage(): () => void {
  return () => {};
}
export function isSupported(): Promise<boolean> {
  return Promise.resolve(false);
}
export function initializeApp(): Record<string, never> {
  return {};
}
export function getApp(): Record<string, never> {
  return {};
}
export function getApps(): never[] {
  return [];
}
