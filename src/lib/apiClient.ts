export const getApiUrl = (endpoint: string) => {
  // If running in Capacitor/Mobile, we need the full URL
  // You can detect Capacitor using capacitor object or specific env vars
  const isCapacitor = typeof window !== 'undefined' && (window as any).Capacitor !== undefined;
  const baseUrl = isCapacitor ? 'https://cliente.virgulacontabil.com.br' : '';
  
  return `${baseUrl}${endpoint}`;
};

/**
 * Absolute URL for the authenticated document endpoint. Safe to use as an
 * <a href>, <img src> or pdf.js source: the JWT rides in the query string
 * because those contexts can't set an Authorization header. The server sends
 * `Cache-Control: private, no-store` + `Referrer-Policy: no-referrer` back.
 *
 * `as` picks which stored token to attach ("client" is the default; pass
 * "accountant" from the admin panel).
 */
export const documentFileUrl = (
  docId: string,
  opts: { download?: boolean; as?: "client" | "accountant" } = {},
): string => {
  const as = opts.as ?? "client";
  const token =
    as === "accountant"
      ? localStorage.getItem("accountantToken")
      : localStorage.getItem("clientToken") || sessionStorage.getItem("clientToken");

  const qs = new URLSearchParams();
  if (token) qs.set("token", token);
  if (opts.download) qs.set("download", "1");
  const query = qs.toString();
  return getApiUrl(`/api/documents/${docId}/file`) + (query ? `?${query}` : "");
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
