// ---------------------------------------------------------------------------
// One auth client for every platform (browser, installed PWA, Capacitor
// Android/iOS). The backend is identical everywhere:
//
//   login  -> { token (access, ~15 min), refreshToken (~90 days) }
//   access token expires -> POST /api/auth/refresh { refreshToken }
//                        -> { token, refreshToken }   (refresh token rotates)
//   refresh fails (expired / revoked / reused) -> real re-login required
//
// The access token lives in memory (sync reads for pdf.js). Both tokens are
// persisted so a reload / app restart keeps the user signed in:
//   - web / PWA : localStorage (or sessionStorage when "remember me" is off)
//   - Capacitor : a secure-storage plugin when the native wrapper provides one
//                 (SecureStoragePlugin), otherwise the WebView's own
//                 app-private localStorage. Never a shared browser store.
// ---------------------------------------------------------------------------

export const getApiUrl = (endpoint: string) => {
  const isCapacitor =
    typeof window !== "undefined" && (window as any).Capacitor !== undefined;
  const baseUrl = isCapacitor ? "https://cliente.virgulacontabil.com.br" : "";
  return `${baseUrl}${endpoint}`;
};

type UserType = "client" | "accountant";

interface TokenPair {
  access: string;
  refresh: string;
}

// --- persistence backends --------------------------------------------------

const STORAGE_KEYS: Record<UserType, { access: string; refresh: string; remember: string }> = {
  client: { access: "clientToken", refresh: "clientRefreshToken", remember: "clientRemember" },
  accountant: { access: "accountantToken", refresh: "accountantRefreshToken", remember: "accountantRemember" },
};

const isCapacitor = () =>
  typeof window !== "undefined" && (window as any).Capacitor !== undefined;

const secureStore = () => {
  try {
    return (window as any)?.Capacitor?.Plugins?.SecureStoragePlugin || null;
  } catch {
    return null;
  }
};

function webGet(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function webSet(key: string, value: string, remember: boolean) {
  try {
    (remember ? localStorage : sessionStorage).setItem(key, value);
    (remember ? sessionStorage : localStorage).removeItem(key);
  } catch {
    /* private mode / disabled storage */
  }
}
function webRemove(key: string) {
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// --- in-memory session state ---------------------------------------------

const mem: Record<UserType, TokenPair | null> = { client: null, accountant: null };
const rememberFlag: Record<UserType, boolean> = { client: true, accountant: true };

// Synchronous hydrate from web storage (covers browser, PWA and the Capacitor
// WebView). Runs at module load so the first render already sees the session.
for (const kind of ["client", "accountant"] as UserType[]) {
  const k = STORAGE_KEYS[kind];
  const access = webGet(k.access);
  const refresh = webGet(k.refresh);
  rememberFlag[kind] = webGet(k.remember) !== "0";
  if (access && refresh) mem[kind] = { access, refresh };
}

// Async hydrate from a native secure store, if the wrapper provides one. Any
// value found there wins over the WebView copy.
let hydratedPromise: Promise<void> | null = null;
export function hydrateSession(): Promise<void> {
  if (hydratedPromise) return hydratedPromise;
  hydratedPromise = (async () => {
    const store = secureStore();
    if (!store || !isCapacitor()) return;
    for (const kind of ["client", "accountant"] as UserType[]) {
      const k = STORAGE_KEYS[kind];
      try {
        const access = (await store.get({ key: k.access }))?.value;
        const refresh = (await store.get({ key: k.refresh }))?.value;
        if (access && refresh) {
          mem[kind] = { access, refresh };
          webSet(k.access, access, true);
          webSet(k.refresh, refresh, true);
        }
      } catch {
        /* key not present */
      }
    }
  })();
  return hydratedPromise;
}
// kick it off; callers still await it in apiFetch
void hydrateSession();

async function persist(kind: UserType, pair: TokenPair | null, remember: boolean) {
  const k = STORAGE_KEYS[kind];
  if (pair) {
    webSet(k.access, pair.access, remember);
    webSet(k.refresh, pair.refresh, remember);
    webSet(k.remember, remember ? "1" : "0", remember);
  } else {
    webRemove(k.access);
    webRemove(k.refresh);
    webRemove(k.remember);
  }
  const store = secureStore();
  if (store && isCapacitor()) {
    try {
      if (pair) {
        await store.set({ key: k.access, value: pair.access });
        await store.set({ key: k.refresh, value: pair.refresh });
      } else {
        await store.remove({ key: k.access }).catch(() => {});
        await store.remove({ key: k.refresh }).catch(() => {});
      }
    } catch {
      /* fall back to the web copy already written */
    }
  }
}

// --- public session API -------------------------------------------------

export interface SaveSessionInput {
  kind: UserType;
  token: string; // access
  refreshToken: string;
  remember?: boolean;
}

export function saveSession({ kind, token, refreshToken, remember = true }: SaveSessionInput) {
  mem[kind] = { access: token, refresh: refreshToken };
  rememberFlag[kind] = remember;
  void persist(kind, mem[kind], remember);
}

export function clearSession(kind: UserType) {
  mem[kind] = null;
  void persist(kind, null, rememberFlag[kind]);
}

// Revoke the session server-side (best-effort) then drop it locally.
export async function logout(kind: UserType): Promise<void> {
  const refresh = mem[kind]?.refresh;
  clearSession(kind);
  if (refresh) {
    try {
      await fetch(getApiUrl("/api/auth/logout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
        keepalive: true,
      });
    } catch {
      /* offline — the local clear is what matters */
    }
  }
}

export function getAccessToken(kind: UserType): string | null {
  return mem[kind]?.access ?? null;
}

export function hasSession(kind: UserType): boolean {
  return mem[kind] != null;
}

// --- token freshness / refresh ----------------------------------------

function decodeExp(jwtToken: string): number | null {
  try {
    const payload = JSON.parse(atob(jwtToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

const refreshInFlight: Record<UserType, Promise<boolean> | null> = { client: null, accountant: null };

async function doRefresh(kind: UserType): Promise<boolean> {
  const pair = mem[kind];
  if (!pair?.refresh) return false;
  try {
    const res = await fetch(getApiUrl("/api/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: pair.refresh }),
    });
    if (!res.ok) {
      clearSession(kind);
      return false;
    }
    const data = await res.json();
    if (!data?.token || !data?.refreshToken) {
      clearSession(kind);
      return false;
    }
    saveSession({ kind, token: data.token, refreshToken: data.refreshToken, remember: rememberFlag[kind] });
    return true;
  } catch {
    return false; // network error — keep the session, let the caller surface it
  }
}

// Single-flight refresh: many requests failing at once share one call.
function refreshAccess(kind: UserType): Promise<boolean> {
  if (!refreshInFlight[kind]) {
    refreshInFlight[kind] = doRefresh(kind).finally(() => {
      refreshInFlight[kind] = null;
    });
  }
  return refreshInFlight[kind]!;
}

// Refresh proactively if the access token is missing or within 60s of expiry.
// Used before handing the token to something that can't retry (pdf.js).
export async function ensureFreshAccess(kind: UserType = "client"): Promise<void> {
  await hydrateSession();
  const token = mem[kind]?.access;
  const exp = token ? decodeExp(token) : null;
  if (!token || (exp !== null && exp * 1000 - Date.now() < 60_000)) {
    await refreshAccess(kind);
  }
}

function onAuthLost(kind: UserType) {
  clearSession(kind);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("unauthorized"));
  }
}

// --- documents ---------------------------------------------------------

/**
 * Plain (token-less) URL of the authenticated document endpoint. The JWT is
 * NEVER put in the query string — callers send it in the Authorization header
 * (apiFetch / openDocument do this; pdf.js takes documentAuthHeaders()).
 */
export const documentFileUrl = (docId: string, opts: { download?: boolean } = {}): string =>
  getApiUrl(`/api/documents/${docId}/file`) + (opts.download ? "?download=1" : "");

/** Authorization header for contexts that fetch a URL directly (pdf.js). */
export const documentAuthHeaders = (as: UserType = "client"): Record<string, string> => {
  const token = getAccessToken(as);
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Like documentAuthHeaders, but first makes sure the access token is fresh. */
export const documentAuthHeadersFresh = async (
  as: UserType = "client",
): Promise<Record<string, string>> => {
  await ensureFreshAccess(as);
  return documentAuthHeaders(as);
};

/**
 * Fetches a document through the authenticated endpoint and either opens it in
 * a new tab ("view") or triggers a download.
 */
export const openDocument = async (
  docId: string,
  action: "view" | "download",
  opts: { as?: UserType; filename?: string } = {},
): Promise<void> => {
  const res = await apiFetch(
    `/api/documents/${docId}/file${action === "download" ? "?download=1" : ""}`,
    {},
    opts.as ?? "client",
  );
  if (!res.ok) throw new Error(`Falha ao obter o documento (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    if (action === "view") {
      const w = window.open(url, "_blank");
      if (!w) window.location.href = url;
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = opts.filename || "documento";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
};

// --- the fetch wrapper -------------------------------------------------

export const apiFetch = async (
  endpoint: string,
  options: RequestInit = {},
  userType: UserType = "client",
): Promise<Response> => {
  await hydrateSession();

  const isAuthRoute = endpoint.includes("/api/auth/");

  const run = async (): Promise<Response> => {
    const headers = new Headers(options.headers);
    const token = getAccessToken(userType);
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(getApiUrl(endpoint), { ...options, headers });
  };

  let response = await run();

  // Access token expired mid-session: rotate and retry once. Never for the
  // auth endpoints themselves (login/refresh/verify).
  if (response.status === 401 && !isAuthRoute && mem[userType]?.refresh) {
    const ok = await refreshAccess(userType);
    if (ok) {
      response = await run();
    }
    if (!ok || response.status === 401) {
      onAuthLost(userType);
    }
  }

  return response;
};
