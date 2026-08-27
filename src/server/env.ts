// Centralised environment configuration + validation.
//
// Called once from server.ts during startup. In production we fail fast on
// missing/insecure secrets instead of silently falling back to well-known
// development defaults (which would let anyone forge admin tokens or brute
// force the admin login).

// Values that ship in .env.example / code fallbacks and must never reach prod.
const INSECURE_VALUES = new Set([
  "admin",
  "admin_password",
  "your_long_random_secret_string_here",
  "virgula-secret-key-persistent-across-deploys-12345",
  "insecure-dev-only-secret-do-not-use-in-production",
  "re_123",
  "MY_GEMINI_API_KEY",
]);

const REQUIRED_SECRETS = ["JWT_SECRET", "ADMIN", "PASSWORD"] as const;
const RECOMMENDED = [
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "CORS_ORIGINS",
  "SECRETS_KEY",
] as const;

export interface EnvReport {
  problems: string[];
  warnings: string[];
}

// Pure — collects issues without touching the process. Exported for testing.
export function collectEnvIssues(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const name of REQUIRED_SECRETS) {
    const value = env[name];
    if (!value || INSECURE_VALUES.has(value)) {
      problems.push(`${name} is missing or set to a well-known default.`);
    }
  }
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is required.");

  for (const name of RECOMMENDED) {
    if (!env[name]) warnings.push(`${name} is not set — the related feature will be limited.`);
  }

  return { problems, warnings };
}

export function validateEnv() {
  const { problems, warnings } = collectEnvIssues();

  for (const w of warnings) console.warn(`[env] ${w}`);

  if (problems.length === 0) return;

  const msg =
    "Environment configuration errors:\n" +
    problems.map((p) => `  - ${p}`).join("\n");

  if (process.env.NODE_ENV === "production") {
    throw new Error(msg);
  }
  console.warn(
    `[env] ${msg}\n[env] Continuing with insecure defaults because NODE_ENV !== "production".`,
  );
}

// Allowed browser origins for CORS. Empty in dev (reflect request origin);
// must be an explicit allow-list in production.
export function corsOrigins(): string[] {
  return (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const PORT = Number(process.env.PORT) || 3000;

// How many reverse-proxy hops to trust for X-Forwarded-For (rate limiting +
// req.ip depend on this). EasyPanel/Traefik and Cloud Run put exactly ONE
// proxy in front, so 1 is the correct, safe default — it trusts only the hop
// the proxy itself adds and ignores any client-supplied X-Forwarded-For.
// Never set this to `true`: that would let clients spoof their IP and dodge
// the rate limiters. Override with TRUST_PROXY only if your infra genuinely
// has more hops (e.g. Cloudflare -> Traefik -> app => 2).
export function trustProxy(): number {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[env] TRUST_PROXY=${raw} is not a non-negative number — using 1`);
    return 1;
  }
  return Math.floor(n);
}
