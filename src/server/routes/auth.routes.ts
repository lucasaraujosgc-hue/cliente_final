import { Express } from "express";
import jwt from "jsonwebtoken";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { clients } from "../schema";
import { formatCnpj } from "../../lib/cnpj";
import { resend } from "../services/mailer";
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
import { JWT_SECRET } from "../middleware/auth";
import {
  authLimiter,
  passwordResetRequestLimiter,
  passwordResetSubmitLimiter,
} from "../middleware/rateLimit";
import { validateBody } from "../middleware/validate";
import {
  clientForgotPasswordSchema,
  clientResetPasswordSchema,
  clientLoginSchema,
  accountantLoginSchema,
} from "../schemas/validation";

// Identical response for every forgot-password outcome (found / not found /
// no email) so the endpoint can't be used to probe which CNPJs are clients.
const FORGOT_PASSWORD_OK = {
  success: true,
  message:
    "Se este CNPJ estiver cadastrado e tiver um e-mail, um código de recuperação foi enviado.",
};

// Look up clients by CNPJ ignoring formatting (dots / slashes / dashes),
// filtering in SQL so we never pull the whole clients table into memory just
// to `.find()` over it — that turned every login attempt into an O(n)
// bcrypt-compare loop and an easy CPU-exhaustion lever.
function findClientsByCnpj(rawCnpj: string) {
  const clean = String(rawCnpj).replace(/\D/g, "");
  return db
    .select()
    .from(clients)
    .where(sql`regexp_replace(${clients.cnpj}, '[^0-9]', '', 'g') = ${clean}`);
}

// Login / password-recovery routes for both clients and the accountant admin.
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

        // Success: set the new password and invalidate the code immediately
        // (single use).
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

    // Check if it's the admin
    const adminUser = String(process.env.ADMIN || "admin").trim();
    const adminPass = String(process.env.PASSWORD || "admin_password").trim();

    const inputUserNum = String(cnpj).replace(/\D/g, "");
    const adminUserNum = adminUser.replace(/\D/g, "");

    const userMatch =
      String(cnpj) === adminUser ||
      (adminUserNum.length > 0 && adminUserNum === inputUserNum);
    if (userMatch && String(password).trim() === adminPass) {
      const token = jwt.sign(
        { role: "accountant", name: "Contador" },
        JWT_SECRET,
        { expiresIn: "30d" },
      );
      return res.json({
        token,
        role: "accountant",
        user: { name: "Contador" },
      });
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
    const token = jwt.sign(
      { clientId: client.id, role: "client", name: client.name },
      JWT_SECRET,
      { expiresIn: "30d" },
    );
    res.json({
      token,
      role: "client",
      client: {
        id: client.id,
        name: client.name,
        cnpj: client.cnpj,
        firstAccessDone: client.firstAccessDone,
      },
    });
  });

  // Accountant Login
  app.post("/api/auth/accountant/login", authLimiter, validateBody(accountantLoginSchema), (req, res) => {
    const { username, password } = req.body;

    const adminUser = String(process.env.ADMIN || "admin").trim();
    const adminPass = String(process.env.PASSWORD || "admin_password").trim();

    const inputUserNum = String(username).replace(/\D/g, "");
    const adminUserNum = adminUser.replace(/\D/g, "");
    const userMatch =
      username === adminUser ||
      (adminUserNum.length > 0 && adminUserNum === inputUserNum);

    if (userMatch && String(password).trim() === adminPass) {
      const token = jwt.sign(
        { role: "accountant", name: "Contador" },
        JWT_SECRET,
        { expiresIn: "30d" },
      );
      return res.json({ token, user: { name: "Contador" } });
    }
    res.status(401).json({ error: "Credenciais inválidas" });
  });
}
