export const getApiUrl = (endpoint: string) => {
  // If running in Capacitor/Mobile, we need the full URL
  // You can detect Capacitor using capacitor object or specific env vars
  const isCapacitor = typeof window !== 'undefined' && (window as any).Capacitor !== undefined;
  const baseUrl = isCapacitor ? 'https://cliente.virgulacontabil.com.br' : '';
  
  return `${baseUrl}${endpoint}`;
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
