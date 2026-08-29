import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Login limiter. Kept as a brute-force backstop, but scoped so a shared office
// connection is never the unit of lockout:
//  - only FAILED logins count (skipSuccessfulRequests) — anyone who signs in
//    fine never moves the counter;
//  - the counter is keyed by the account being targeted (CNPJ / username), not
//    by IP — one person fat-fingering their password can't block a colleague.
// An attacker rotating the identifier field still hits the app-wide apiLimiter.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 30,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const raw = req.body?.cnpj ?? req.body?.username ?? "";
    const id = String(raw).replace(/[^\w]/g, "").toLowerCase();
    return id ? `login:${id}` : `login-ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      "Muitas tentativas para esta conta. Aguarde alguns minutos e tente de novo.",
  },
});

// forgot-password: each hit can trigger an email, so keep it tight. Per-IP.
export const passwordResetRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas solicitações de recuperação. Tente novamente mais tarde." },
});

// reset-password (submitting a code): the per-account attempt cap in
// resetCode.ts is the real defence; this just stops IP-level hammering.
export const passwordResetSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Tente novamente em alguns minutos." },
});

// Token refresh: legit clients hit this ~once per 15 min per session (plus a
// small burst on app open). The opaque rotating refresh token is the real
// gate; this just caps abuse. Per-IP, generous enough for several devices
// behind one NAT.
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas renovações de sessão. Tente novamente em instantes." },
});

// Looser limiter for the external webhook endpoints. These are called by
// trusted integration partners, but a misbehaving client (or a leaked URL)
// shouldn't be able to hammer the server or fill the disk with uploads.
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Limite de requisições excedido. Tente novamente em instantes." },
});

// General-purpose limiter for authenticated API traffic, applied app-wide
// as a safety net against runaway clients/scripts.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
