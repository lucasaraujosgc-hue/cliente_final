import { Express, Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { clients } from "../schema";
import { formatCnpj } from "../../lib/cnpj";
import { resend, transporter } from "../services/mailer";
import { hashPassword, verifyPassword } from "../services/password";
import {
  generateResetCode,
  hashResetCode,
  verifyResetCode,
  resetCodeExpiry,
  issuedTooRecently,
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_TTL_MS,
} from "../services/resetCode";
import {
  createSession,
  rotateSession,
  revokeSessionByRefreshToken,
  revokeAllSessionsForSubject,
  RefreshError,
} from "../services/session";
import {
  createChallenge,
  verifyChallenge,
  accountantMfaEnabled,
  accountantMfaEmail,
} from "../services/accountantMfa";
import { logger } from "../services/logger";
import {
  authLimiter,
  passwordResetRequestLimiter,
  passwordResetSubmitLimiter,
  refreshLimiter,
} from "../middleware/rateLimit";
import { validateBody } from "../middleware/validate";
import {
  clientForgotPasswordSchema,
  clientResetPasswordSchema,
  clientLoginSchema,
  accountantLoginSchema,
  accountantMfaVerifySchema,
  refreshTokenSchema,
} from "../schemas/validation";

// Identical response for every forgot-password outcome (found / not found /
// no email) so the endpoint can't be used to probe which CNPJs are clients.
const FORGOT_PASSWORD_OK = {
  success: true,
  message:
    "Se este CNPJ estiver cadastrado e tiver um e-mail, um código de recuperação foi enviado.",
};

const ACCOUNTANT_SUBJECT_ID = "accountant";

// Look up clients by CNPJ. `clients.cnpj` is stored digits-only (migration
// 0002, enforced on every insert via normalizeCnpj), so this is a plain
// equality on the UNIQUE column — it uses the index and can't be turned into
// an O(n) bcrypt-compare loop by feeding punctuation.
function findClientsByCnpj(rawCnpj: string) {
  const clean = String(rawCnpj).replace(/\D/g, "");
  return db.select().from(clients).where(eq(clients.cnpj, clean));
}

// The accountant is a single env-configured account (no DB row).
function isAdminLogin(user: string, pass: string): boolean {
  const adminUser = String(process.env.ADMIN || "admin").trim();
  const adminPass = String(process.env.PASSWORD || "admin_password").trim();
  const inputNum = String(user).replace(/\D/g, "");
  const adminNum = adminUser.replace(/\D/g, "");
  const userMatch =
    String(user) === adminUser || (adminNum.length > 0 && adminNum === inputNum);
  return userMatch && String(pass).trim() === adminPass;
}

function userAgentOf(req: Request): string {
  return String(req.headers["user-agent"] || "").slice(0, 400);
}

async function sendAccountantMfaCode(email: string, code: string): Promise<void> {
  const minutes = 10;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color:#1f2937;">
      <h2>Código de acesso — Painel do Contador</h2>
      <p>Use o código abaixo para concluir o login:</p>
      <h1 style="background:#f4f4f5;padding:16px;text-align:center;letter-spacing:6px;border-radius:8px;">${code}</h1>
      <p>Expira em ${minutes} minutos e só pode ser usado uma vez.</p>
      <p>Se não foi você tentando entrar, altere a senha do painel imediatamente.</p>
    </div>`;
  if (process.env.RESEND_API_KEY) {
    await resend.emails.send({
      from: "Portal Contábil <onboarding@resend.dev>",
      to: email,
      subject: "Código de acesso ao Painel do Contador",
      html,
    });
    return;
  }
  if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
    const fromName = process.env.EMAIL_FROM_NAME || "Vírgula Contábil";
    const alias = process.env.EMAIL_ALIAS || process.env.EMAIL_USER;
    await transporter.sendMail({
      from: `"${fromName}" <${alias}>`,
      to: email,
      subject: "Código de acesso ao Painel do Contador",
      html,
    });
    return;
  }
  throw new Error("no mailer configured for accountant 2FA");
}

// Starts (or, if a valid one is pending and recent, resends) the accountant
// second-factor challenge. Returns the payload the client should get.
async function beginAccountantMfa(
  req: Request,
  existingChallengeId?: string,
): Promise<{ mfaRequired: true; challengeId: string }> {
  const email = accountantMfaEmail();
  const { challengeId, code, cooldown } = createChallenge(existingChallengeId);
  if (!cooldown && email) {
    try {
      await sendAccountantMfaCode(email, code);
    } catch (err: any) {
      logger.error("Failed to send accountant 2FA code", { err: err?.message });
      // Fall through: the challenge still exists; the accountant can retry the
      // send. We deliberately don't leak the failure detail.
    }
  }
  return { mfaRequired: true, challengeId };
}

// Login / password-recovery / session routes for both clients and the
// accountant admin.
export function registerAuthRoutes(app: Express) {
  app.post(
    "/api/auth/client/forgot-password",
    passwordResetRequestLimiter,
    validateBody(clientForgotPasswordSchema),
    async (req, res) => {
      // Respond the same way no matter what — see FORGOT_PASSWORD_OK. Any work
      // that varies with "does this client exist" is done AFTER the response is
      // sent so it can't be timed, and the email is fire-and-forget.
      res.json(FORGOT_PASSWORD_OK);

      try {
        const client = (await findClientsByCnpj(req.body.cnpj))[0];
        if (!client || !client.email) return;

        // Still a valid code from a request less than a minute ago → don't
        // generate a new one or send another email (anti email-bombing).
        if (client.resetCodeHash && client.resetCodeExpires && issuedTooRecently(client.resetCodeExpires)) {
          return;
        }

        const code = generateResetCode();
        await db
          .update(clients)
          .set({
            resetCodeHash: hashResetCode(code),
            resetCodeExpires: resetCodeExpiry(),
            resetCodeAttempts: 0,
          })
          .where(eq(clients.id, client.id));

        const minutes = Math.round(RESET_CODE_TTL_MS / 60000);
        if (process.env.RESEND_API_KEY) {
          resend.emails
            .send({
              from: "Portal Contábil <onboarding@resend.dev>",
              to: client.email,
              subject: "Recuperação de Senha - Portal do Cliente",
              html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                   <h2>Recuperação de Senha</h2>
                   <p>Você solicitou a recuperação de senha para o CNPJ <strong>${formatCnpj(client.cnpj)}</strong>.</p>
                   <p>Seu código de verificação é:</p>
                   <h1 style="background: #f4f4f5; padding: 16px; text-align: center; letter-spacing: 4px; border-radius: 8px;">${code}</h1>
                   <p>Este código expira em ${minutes} minutos e só pode ser usado uma vez.</p>
                   <p>Se você não solicitou, ignore este e-mail.</p>
                </div>
              `,
            })
            .catch((err) => console.error("forgot-password: email send failed:", err?.message));
        }
      } catch (err: any) {
        // Never surface this to the caller (already responded); never log the code.
        console.error("forgot-password: background failure:", err?.message);
      }
    },
  );

  // Client Reset Password
  app.post(
    "/api/auth/client/reset-password",
    passwordResetSubmitLimiter,
    validateBody(clientResetPasswordSchema),
    async (req, res) => {
      const { cnpj, code, newPassword } = req.body;
      // One generic failure for every rejection reason (unknown CNPJ, no code
      // pending, expired, too many attempts, wrong code) — no oracle.
      const invalid = () =>
        res.status(400).json({ error: "Código inválido ou expirado. Solicite um novo." });

      try {
        const client = (await findClientsByCnpj(cnpj))[0];
        if (!client || !client.resetCodeHash || !client.resetCodeExpires) {
          return invalid();
        }
        if (client.resetCodeExpires.getTime() < Date.now()) {
          return invalid();
        }
        if ((client.resetCodeAttempts ?? 0) >= RESET_CODE_MAX_ATTEMPTS) {
          // Burn the code so further guesses are pointless.
          await db
            .update(clients)
            .set({ resetCodeHash: null, resetCodeExpires: null, resetCodeAttempts: 0 })
            .where(eq(clients.id, client.id));
          return invalid();
        }

        if (!verifyResetCode(code, client.resetCodeHash)) {
          await db
            .update(clients)
            .set({ resetCodeAttempts: (client.resetCodeAttempts ?? 0) + 1 })
            .where(eq(clients.id, client.id));
          return invalid();
        }

        // Success: set the new password, invalidate the code (single use), and
        // kill every existing session for this client — a password reset must
        // log the account out everywhere.
        await db
          .update(clients)
          .set({
            passwordHash: await hashPassword(newPassword),
            resetCodeHash: null,
            resetCodeExpires: null,
            resetCodeAttempts: 0,
            firstAccessDone: true,
          })
          .where(eq(clients.id, client.id));
        await revokeAllSessionsForSubject("client", client.id);

        res.json({ success: true });
      } catch (err: any) {
        console.error("reset-password: failure:", err?.message);
        res.status(500).json({ error: "Erro ao redefinir a senha." });
      }
    },
  );

  // Client Login
  app.post("/api/auth/client/login", authLimiter, validateBody(clientLoginSchema), async (req, res) => {
    const { cnpj, password } = req.body;

    // Admin can also sign in from the client form. That path is subject to the
    // same 2FA as /api/auth/accountant/login.
    if (isAdminLogin(cnpj, password)) {
      if (accountantMfaEnabled()) {
        return res.json({ ...(await beginAccountantMfa(req)), role: "accountant" });
      }
      const tokens = await createSession(
        { subjectType: "accountant", subjectId: ACCOUNTANT_SUBJECT_ID, name: "Contador" },
        userAgentOf(req),
      );
      return res.json({ ...tokens, role: "accountant", user: { name: "Contador" } });
    }

    // The first-access password is the client's CNPJ, which is now stored
    // digits-only. Accept the CNPJ typed in any punctuation for that case.
    const passwordDigits = String(password).replace(/\D/g, "");
    const candidates =
      passwordDigits && passwordDigits !== String(password)
        ? [String(password), passwordDigits]
        : [String(password)];

    const clientList = await findClientsByCnpj(cnpj);
    let matchedClient: (typeof clientList)[number] | undefined;
    for (const c of clientList) {
      for (const attempt of candidates) {
        const { valid, needsRehash } = await verifyPassword(attempt, String(c.passwordHash));
        if (!valid) continue;
        matchedClient = c;
        if (needsRehash) {
          // Silently upgrade legacy plaintext passwords to a proper bcrypt hash.
          const newHash = await hashPassword(attempt);
          await db.update(clients).set({ passwordHash: newHash }).where(eq(clients.id, c.id));
        }
        break;
      }
      if (matchedClient) break;
    }
    const client = matchedClient;

    if (!client) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const tokens = await createSession(
      { subjectType: "client", subjectId: client.id, clientId: client.id, name: client.name },
      userAgentOf(req),
    );
    res.json({
      ...tokens,
      role: "client",
      client: {
        id: client.id,
        name: client.name,
        cnpj: client.cnpj,
        firstAccessDone: client.firstAccessDone,
      },
    });
  });

  // Accountant Login — step 1 (credentials). With 2FA on, returns a challenge;
  // the token pair is issued only by /verify.
  app.post("/api/auth/accountant/login", authLimiter, validateBody(accountantLoginSchema), async (req, res) => {
    const { username, password } = req.body;
    if (!isAdminLogin(username, password)) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }
    if (accountantMfaEnabled()) {
      return res.json(await beginAccountantMfa(req));
    }
    const tokens = await createSession(
      { subjectType: "accountant", subjectId: ACCOUNTANT_SUBJECT_ID, name: "Contador" },
      userAgentOf(req),
    );
    res.json({ ...tokens, user: { name: "Contador" } });
  });

  // Accountant Login — step 2 (2FA code). Also handles "resend": POST with the
  // same challengeId and no code re-sends within the cooldown.
  app.post("/api/auth/accountant/verify", authLimiter, async (req, res) => {
    const challengeId = String(req.body?.challengeId || "");
    const wantsResend = !req.body?.code && challengeId;
    if (wantsResend) {
      const out = await beginAccountantMfa(req, challengeId);
      return res.json(out);
    }

    const parsed = accountantMfaVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos.", details: parsed.error.issues });
    }

    const result = verifyChallenge(parsed.data.challengeId, parsed.data.code);
    if (result !== "ok") {
      const msg =
        result === "too_many_attempts"
          ? "Muitas tentativas. Faça o login novamente."
          : "Código inválido ou expirado.";
      return res.status(401).json({ error: msg, code: "mfa_failed" });
    }

    const tokens = await createSession(
      { subjectType: "accountant", subjectId: ACCOUNTANT_SUBJECT_ID, name: "Contador" },
      userAgentOf(req),
    );
    res.json({ ...tokens, user: { name: "Contador" } });
  });

  // Silent session renewal. The client calls this when an access token expires;
  // it rotates the refresh token and issues a fresh pair. One generic 401 for
  // every failure (unknown / revoked / expired / reused).
  app.post(
    "/api/auth/refresh",
    refreshLimiter,
    validateBody(refreshTokenSchema),
    async (req, res) => {
      try {
        const tokens = await rotateSession(req.body.refreshToken, userAgentOf(req));
        res.json(tokens);
      } catch (err) {
        if (err instanceof RefreshError) {
          return res.status(401).json({ error: "Sessão inválida. Faça login novamente.", code: "refresh_invalid" });
        }
        throw err;
      }
    },
  );

  // Logout: revoke the session server-side. Lenient (a client with an already
  // cleared token still gets a clean 204) and idempotent.
  app.post("/api/auth/logout", async (req, res) => {
    const refreshToken = String(req.body?.refreshToken || "");
    if (refreshToken) {
      try {
        await revokeSessionByRefreshToken(refreshToken);
      } catch (err: any) {
        logger.warn("logout: revoke failed", { err: err?.message });
      }
    }
    res.status(204).end();
  });
}
