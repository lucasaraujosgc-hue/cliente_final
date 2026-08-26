import { Express } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { isBefore, parseISO } from "date-fns";
import { db } from "../db";
import { clients } from "../schema";
import { resend } from "../services/mailer";
import { JWT_SECRET } from "../middleware/auth";

// Login / password-recovery routes for both clients and the accountant admin.
export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/client/forgot-password", async (req, res) => {
    try {
      const { cnpj } = req.body;
      const cleanCnpj = String(cnpj).replace(/\D/g, "");
      const clientList = await db.select().from(clients);
      const client = clientList.find(c => String(c.cnpj).replace(/\D/g, "") === cleanCnpj);

      if (!client) {
        return res.status(404).json({ error: "CNPJ não encontrado." });
      }

      if (!client.email) {
        return res.status(400).json({ error: "Nenhum e-mail cadastrado para este cliente." });
      }

      const token = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
      const expires = new Date(Date.now() + 3600000).toISOString(); // 1 hour

      await db.update(clients)
        .set({ resetToken: token, resetTokenExpires: expires })
        .where(eq(clients.id, client.id));

      if (process.env.RESEND_API_KEY) {
        await resend.emails.send({
          from: "Portal Contábil <onboarding@resend.dev>",
          to: client.email,
          subject: "Recuperação de Senha - Portal do Cliente",
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
               <h2>Recuperação de Senha</h2>
               <p>Você solicitou a recuperação de senha para o CNPJ <strong>${client.cnpj}</strong>.</p>
               <p>Seu código de verificação é:</p>
               <h1 style="background: #f4f4f5; padding: 16px; text-align: center; letter-spacing: 4px; border-radius: 8px;">${token}</h1>
               <p>Este código expira em 1 hora.</p>
               <p>Se você não solicitou, ignore este e-mail.</p>
            </div>
          `
        });
      }
      
      res.json({ success: true });
    } catch(err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Client Reset Password
  app.post("/api/auth/client/reset-password", async (req, res) => {
    try {
      const { cnpj, token, newPassword } = req.body;
      const cleanCnpj = String(cnpj).replace(/\D/g, "");
      const clientList = await db.select().from(clients);
      const client = clientList.find(c => String(c.cnpj).replace(/\D/g, "") === cleanCnpj);

      if (!client) {
        return res.status(404).json({ error: "CNPJ não encontrado." });
      }

      if (client.resetToken !== token) {
        return res.status(400).json({ error: "Código inválido." });
      }

      if (!client.resetTokenExpires || isBefore(parseISO(client.resetTokenExpires), new Date())) {
         return res.status(400).json({ error: "Código expirado." });
      }

      await db.update(clients)
        .set({ 
          passwordHash: newPassword,
          resetToken: null,
          resetTokenExpires: null,
          firstAccessDone: true 
        })
        .where(eq(clients.id, client.id));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Client Login
  app.post("/api/auth/client/login", async (req, res) => {
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

    const cleanCnpj = String(cnpj).replace(/\D/g, "");

    const clientList = await db.select().from(clients);
    const client = clientList.find((c) => {
      const dbCnpj = String(c.cnpj).replace(/\D/g, "");
      const dbPassStr = String(c.passwordHash);
      const inputPassStr = String(password);

      const passMatches =
        dbPassStr === inputPassStr ||
        dbPassStr.replace(/\D/g, "") === inputPassStr.replace(/\D/g, "");
      return dbCnpj === cleanCnpj && passMatches;
    });

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
  app.post("/api/auth/accountant/login", (req, res) => {
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
