export const getApiUrl = (endpoint: string) => {
  // If running in Capacitor/Mobile, we need the full URL
  // You can detect Capacitor using capacitor object or specific env vars
  const isCapacitor = typeof window !== 'undefined' && (window as any).Capacitor !== undefined;
  const baseUrl = isCapacitor ? 'https://cliente.virgulacontabil.com.br' : '';
  
  return `${baseUrl}${endpoint}`;
};

type UserType = "client" | "accountant";

const storedToken = (as: UserType): string | null =>
  as === "accountant"
    ? localStorage.getItem("accountantToken")
    : localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");

/**
 * Plain (token-less) URL of the authenticated document endpoint. The JWT is
 * NEVER put in the query string — callers must send it in the Authorization
 * header (apiFetch / openDocument do this; pdf.js takes documentAuthHeaders()).
 */
export const documentFileUrl = (
  docId: string,
  opts: { download?: boolean } = {},
): string =>
  getApiUrl(`/api/documents/${docId}/file`) + (opts.download ? "?download=1" : "");

/** Authorization header for contexts that fetch a URL directly (pdf.js). */
export const documentAuthHeaders = (as: UserType = "client"): Record<string, string> => {
  const token = storedToken(as);
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Fetches a document through the authenticated endpoint and either opens it in
 * a new tab ("view") or triggers a download. Replaces the old
 * `?token=`-in-URL + <a href> approach.
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

export const apiFetch = async (
  endpoint: string,
  options: RequestInit = {},
  userType: "client" | "accountant" = "client"
) => {
  let token = null;

  if (userType === "client") {
    token = localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");
  } else {
    token = localStorage.getItem("accountantToken");
  }

  const headers = new Headers(options.headers);

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const url = getApiUrl(endpoint);

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401 && !endpoint.includes('/api/auth/')) {
    if (userType === "client") {
      localStorage.removeItem("clientToken");
      sessionStorage.removeItem("clientToken");
      window.location.href = "/login";
    } else {
      localStorage.removeItem("accountantToken");
      window.location.href = "/admin/login";
    }
  }

  return response;
};
