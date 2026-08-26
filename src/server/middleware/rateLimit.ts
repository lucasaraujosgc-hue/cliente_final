import rateLimit from "express-rate-limit";

// Strict limiter for login / password-recovery endpoints: these are the
// classic brute-force / credential-stuffing / email-bombing targets.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Tente novamente em alguns minutos." },
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
