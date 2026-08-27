// Centralised environment configuration + validation.
//
// Called once from server.ts during startup. In production we fail fast on
// missing/insecure secrets instead of silently falling back to well-known
// development defaults (which would let anyone forge admin tokens or brute
// force the admin login).

const isProd = process.env.NODE_ENV === "production";

// Values that ship in .env.example / code fallbacks and must never reach prod.
const INSECURE_VALUES = new Set([
  "admin",
  "admin_password",
  "your_long_random_secret_string_here",
  "virgula-secret-key-persistent-across-deploys-12345",
  "re_123",
  "MY_GEMINI_API_KEY",
]);

const problems: string[] = [];
const warnings: string[] = [];

function checkRequiredSecret(name: string) {
  const value = process.env[name];
  if (!value || INSECURE_VALUES.has(value)) {
    problems.push(
      `${name} is missing or set to a well-known default. Set a strong, unique value.`,
    );
  }
}

function checkRecommended(name: string) {
  if (!process.env[name]) {
    warnings.push(`${name} is not set — the related feature will be disabled.`);
  }
}

export function validateEnv() {
  checkRequiredSecret("JWT_SECRET");
  checkRequiredSecret("ADMIN");
  checkRequiredSecret("PASSWORD");

  if (!process.env.DATABASE_URL) {
    problems.push("DATABASE_URL is required.");
  }

  checkRecommended("VAPID_PUBLIC_KEY");
  checkRecommended("VAPID_PRIVATE_KEY");
  checkRecommended("CORS_ORIGINS");

  for (const w of warnings) console.warn(`[env] ${w}`);

  if (problems.length > 0) {
    const msg =
      "Environment configuration errors:\n" +
      problems.map((p) => `  - ${p}`).join("\n");
    if (isProd) {
      throw new Error(msg);
    }
    console.warn(
      `[env] ${msg}\n[env] Continuing with insecure defaults because NODE_ENV !== "production".`,
    );
  }
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
