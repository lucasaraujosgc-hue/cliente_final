import { Express, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import nodemailer from "nodemailer";
import multer from "multer";
import { db } from "./db";
import {
  clients,
  documents,
  billingData,
  messages,
  subscriptions,
  guiasGeradas,
  serproConfig,
  scheduledNotifications,
} from "./schema";
import webpush from "web-push";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

// Initialize Firebase Admin if credentials are provided
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
  try {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Handle escaped newlines in the private key
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    console.log("Firebase Admin initialized successfully.");
  } catch (error) {
    console.error("Firebase Admin initialization error", error);
  }
}



// Generate VAPID keys if they don't exist in env. For development, we can generate them on the fly if needed.
// Usually you'd store these in .env
let vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || "",
  privateKey: process.env.VAPID_PRIVATE_KEY || "",
};

if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
  vapidKeys = webpush.generateVAPIDKeys();
  console.log(
    "Generated new VAPID keys for this session (they won't persist after restart):",
  );
  console.log("Public Key:", vapidKeys.publicKey);
  console.log("Private Key:", vapidKeys.privateKey);
}

webpush.setVapidDetails(
  "mailto:lucasdocarbono@gmail.com",
  vapidKeys.publicKey,
  vapidKeys.privateKey,
);
import { eq, desc, asc, inArray, or } from "drizzle-orm";
import fs from "fs";
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || "re_123");
import https from "https";
import path from "path";
import { differenceInDays, format, isBefore, parseISO } from "date-fns";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
}); // 10 MB limit

const certStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dest = process.env.DATA_PATH
      ? path.join(process.env.DATA_PATH, "certs")
      : path.join(process.cwd(), "data", "certs");
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    cb(null, dest);
  },
  filename: (_req, file, cb) =>
    cb(null, `cert_${Date.now()}_${file.originalname}`),
});
const uploadCert = multer({
  storage: certStorage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".pfx" || ext === ".p12") cb(null, true);
    else cb(new Error("Apenas arquivos .pfx ou .p12 são aceitos."));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});
const JWT_SECRET =
  process.env.JWT_SECRET ||
  "virgula-secret-key-persistent-across-deploys-12345";

// Email Transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.hostinger.com",
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Middlewares
async function verifyIntegrationToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid token" });
  }
  const token = authHeader.split(" ")[1];

  const clientList = await db
    .select()
    .from(clients)
    .where(eq(clients.integrationHash, token));
  if (clientList.length === 0) {
    return res.status(403).json({ error: "Invalid integration token" });
  }

  // Attach client to request
  (req as any).integrationClient = clientList[0];
  next();
}

function verifyClientAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(" ")[1] || (req.query.token as string);
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.role !== "client") throw new Error("Invalid role");

    // Attach to request
    (req as any).user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function verifyAccountantAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(" ")[1] || (req.query.token as string);
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.role !== "accountant") throw new Error("Invalid role");
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function verifyAnyAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(" ")[1] || (req.query.token as string);
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.role !== "client" && payload.role !== "accountant") throw new Error("Invalid role");
    (req as any).user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

interface TokenCache {
  access_token: string;
  jwt_token: string;
  expiresAt: number;
}
const serproTokenCache: { [key: string]: TokenCache } = {};

function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

async function sendClientNotification(clientId: string, title: string, body: string) {
  // Envia push notification
  const subs = await db.select().from(subscriptions).where(eq(subscriptions.clientId, clientId));
  const payload = JSON.stringify({ title, body });
  
  for (const sub of subs) {
    if (sub.subscriptionObject) {
      try {
        await webpush.sendNotification(sub.subscriptionObject as any, payload);
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.delete(subscriptions).where(eq(subscriptions.id, sub.id));
        }
      }
    }
    
    if (sub.fcmToken && getApps().length > 0) {
      try {
        await getMessaging().send({
          token: sub.fcmToken,
          notification: { title, body }
        });
      } catch (err) {
        console.error("Error sending FCM in sendClientNotification", err);
      }
    }
  }
}

// ── Helper HTTP nativo (evita problemas com node-fetch ESM) ──────────────────
function httpsPost(
  urlStr: string,
  headers: Record<string, string>,
  body: string,
  agent?: any,
): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyBuf = Buffer.from(body, "utf8");
    const opts: any = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: "POST",
      headers: { ...headers, "Content-Length": bodyBuf.byteLength },
    };
    if (agent) opts.agent = agent;

    const req = https.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: res.statusCode! >= 200 && res.statusCode! < 300,
          status: res.statusCode!,
          text: async () => text,
          json: async () => JSON.parse(text),
        });
      });
    });
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

async function getSerproToken(config: any, agent?: any): Promise<{ access_token: string; jwt_token: string }> {
  const cacheKey = `${config.consumerKey}:${config.ambiente}`;
  const cached = serproTokenCache[cacheKey];

  // Reutiliza o token se estiver válido e faltar mais de 5 minutos para expirar
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return { access_token: cached.access_token, jwt_token: cached.jwt_token };
  }

  const credentials = Buffer.from(
    `${config.consumerKey}:${config.consumerSecret}`
  ).toString("base64");

  const resp = await httpsPost(
    "https://autenticacao.sapi.serpro.gov.br/authenticate",
    {
      Authorization: `Basic ${credentials}`,
      "role-type": "TERCEIROS",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    "grant_type=client_credentials",
    agent,
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Erro ao obter token SERPRO: ${resp.status} - ${errText}`);
  }
  const data = await resp.json() as any;

  const expiresIn = data.expires_in || 3600;
  const entry: TokenCache = {
    access_token: data.access_token,
    jwt_token: data.jwt_token || "",
    expiresAt: Date.now() + expiresIn * 1000,
  };
  serproTokenCache[cacheKey] = entry;

  return { access_token: entry.access_token, jwt_token: entry.jwt_token };
}

async function serproPost(
  url: string,
  tokens: { access_token: string; jwt_token: string },
  payload: any,
  agent?: any,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.access_token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Cache-Control": "no-cache",
  };
  if (tokens.jwt_token) headers["jwt_token"] = tokens.jwt_token;

  return httpsPost(url, headers, JSON.stringify(payload), agent);
}

const webhookNotificationTimers: Record<string, NodeJS.Timeout> = {};
const webhookNotificationDocs: Record<string, any[]> = {};

export function setupRoutes(app: Express) {
  app.get("/api/fix-db", async (req, res) => {
    await db
      .update(documents)
      .set({ status: "new" })
      .where(eq(documents.status, "waiting_accountant"));
    res.json({ fixed: true });
  });

  // Webhook for receiving files from external systems
  app.post("/api/webhook/receitas", async (req, res) => {
    try {
      const {
        hash_empresa,
        vencimento, // DD/MM/YYYY
        competencia, // MM/YYYY
        categoria,
        nome_arquivo,
        arquivo_base64,
        dados_extraidos,
      } = req.body;

      if (!hash_empresa) {
        return res.status(400).json({ error: "hash_empresa is required" });
      }
      if (!arquivo_base64 && categoria !== "SITFIS_RECEITA") {
        return res
          .status(400)
          .json({ error: "arquivo_base64 is required for this category" });
      }

      // Find client
      const clientList = await db
        .select()
        .from(clients)
        .where(eq(clients.integrationHash, hash_empresa));
      if (clientList.length === 0) {
        return res
          .status(404)
          .json({ error: "Client not found using provided hash" });
      }
      const client = clientList[0];

      // Save file
      let safeFilename = "";
      let pixCode = null;
      let extractedValue = null;
      if (arquivo_base64) {
        const buffer = Buffer.from(arquivo_base64, "base64");
        safeFilename = `${Date.now()}_${nome_arquivo || "documento"}`;
        const filePath = path.join(UPLOADS_DIR, safeFilename);
        fs.writeFileSync(filePath, buffer);

        // Extract Pix Code and Value if it's a PDF
        if (safeFilename.toLowerCase().endsWith(".pdf")) {
          const { extractPixCodeFromPdf, extractValueFromPdfBuffer } = await import("./qrExtractor");
          pixCode = await extractPixCodeFromPdf(buffer);
          extractedValue = await extractValueFromPdfBuffer(buffer, categoria || "");
        }
      }

      // Create document record
      let competence = competencia || "";
      if (!competence && vencimento) {
        // Assume format DD/MM/YYYY and extract MM/YYYY
        const parts = vencimento.split("/");
        if (parts.length >= 2) {
          competence = `${parts[1]}/${parts.length === 3 ? parts[2] : new Date().getFullYear()}`;
        }
      }

      let titleStr =
        categoria === "SITFIS_RECEITA"
          ? `SitFis Extração`
          : nome_arquivo || `Documento ${categoria}`;
      if (
        dados_extraidos &&
        Array.isArray(dados_extraidos) &&
        dados_extraidos.length > 0
      ) {
        titleStr += ` - ${dados_extraidos[0].orgao}: ${dados_extraidos[0].status}`;
      }

      let finalExtractedData: any = dados_extraidos || null;
      if (extractedValue !== null) {
         if (Array.isArray(finalExtractedData)) {
             finalExtractedData = { array: finalExtractedData, extractedValue };
         } else {
             finalExtractedData = finalExtractedData || {};
             finalExtractedData.extractedValue = extractedValue;
         }
      }

      const newDoc = await db
        .insert(documents)
        .values({
          clientId: client.id,
          title: titleStr,
          category: categoria || "webhook_doc",
          competence: competence || "00/0000",
          dueDate: vencimento || null,
          fileUrl: safeFilename ? `/uploads/${safeFilename}` : null,
          pixCode: pixCode,
          extractedData: finalExtractedData,

          status: "new",
          uploadedBy: "accountant", // As it comes from integration system
        })
        .returning();

      // Trigger on_file_available notification logic here for this document (with debounce)
      const clientId = newDoc[0].clientId;

      if (!webhookNotificationDocs[clientId]) {
        webhookNotificationDocs[clientId] = [];
      }
      webhookNotificationDocs[clientId].push(newDoc[0]);

      if (webhookNotificationTimers[clientId]) {
        clearTimeout(webhookNotificationTimers[clientId]);
      }

      webhookNotificationTimers[clientId] = setTimeout(async () => {
        const docs = webhookNotificationDocs[clientId];
        delete webhookNotificationDocs[clientId];
        delete webhookNotificationTimers[clientId];

        try {
          if (docs.length === 1) {
            const rules = await db.select().from(scheduledNotifications)
              .where(eq(scheduledNotifications.type, 'on_file_available'));
            const doc = docs[0];
            for (const rule of rules) {
              if (!rule.clientId || rule.clientId === clientId) {
                let title = (rule.title || "Nova Guia Disponível")
                            .replace(/\[NOME_GUIA\]/g, doc.title || "")
                            .replace(/\[CATEGORIA\]/g, doc.category || "");
                let body = (rule.body || "")
                           .replace(/\[NOME_GUIA\]/g, doc.title || "")
                           .replace(/\[CATEGORIA\]/g, doc.category || "")
                           .replace(/\[VENCIMENTO\]/g, doc.dueDate || "N/A");
                await sendClientNotification(clientId, title, body);
              }
            }
          } else {
            const multiRules = await db.select().from(scheduledNotifications)
              .where(eq(scheduledNotifications.type, 'on_multiple_files_available'));
            let docsList = docs.map((d: any) => `- ${d.title || "Documento"}`).join('\\n');
            for (const rule of multiRules) {
              if (!rule.clientId || rule.clientId === clientId) {
                let title = (rule.title || `Novos Documentos Recebidos (${docs.length})`)
                            .replace(/\[CATEGORIA\]/g, "Múltiplas Categorias")
                            .replace(/\[NOME_GUIA\]/g, "Vários arquivos")
                            .replace(/\[VENCIMENTO\]/g, "Diversos")
                            .replace(/\[LISTA_GUIAS\]/g, docsList);
                let body = (rule.body || "")
                           .replace(/\[CATEGORIA\]/g, "Múltiplas Categorias")
                           .replace(/\[NOME_GUIA\]/g, "Vários arquivos")
                           .replace(/\[VENCIMENTO\]/g, "Diversos")
                           .replace(/\[LISTA_GUIAS\]/g, docsList);
                await sendClientNotification(clientId, title, body);
              }
            }
          }
        } catch(e) {
          console.error("Error in webhook debounced notification", e);
        }
      }, 30000); // 30 seconds debounce

      res.status(200).json({ success: true, documentId: newDoc[0].id });
    } catch (e: any) {
      console.error("Webhook Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // -------------------------------------------------------------
  // AUTH
  // -------------------------------------------------------------

  // Client Forgot Password
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

  // -------------------------------------------------------------
  // INTEGRATION ENGINE (API EXTERNA via Hash)
  // -------------------------------------------------------------

  // Upload doc via API
  app.post(
    "/api/integration/upload-doc",
    verifyIntegrationToken,
    async (req, res) => {
      const client = (req as any).integrationClient;
      const { title, category, dueDate } = req.body;

      const [newDoc] = await db
        .insert(documents)
        .values({
          clientId: client.id,
          title,
          category,
          dueDate,
          status: "new",
          uploadedBy: "accountant",
        })
        .returning();

      res.json({
        success: true,
        document: { ...newDoc, createdAt: newDoc.createdAt.toISOString() },
      });
    },
  );

  // Sync client (update or create)
  app.post(
    "/api/integration/sync-client",
    verifyIntegrationToken,
    async (req, res) => {
      const { cnpj, name, regularityStatus } = req.body;
      const integrationClient = (req as any).integrationClient;

      // Segurança: O token de integração de um cliente só pode sincronizar o faturamento dele mesmo (mesmo CNPJ)!
      if (cnpj.replace(/\D/g, "") !== integrationClient.cnpj.replace(/\D/g, "")) {
        return res.status(403).json({ error: "Acesso negado. Token não autorizado para este CNPJ." });
      }

      const clientList = await db
        .select()
        .from(clients)
        .where(eq(clients.cnpj, cnpj));
      let client;
      if (clientList.length === 0) {
        [client] = await db
          .insert(clients)
          .values({
            cnpj,
            name,
            passwordHash: cnpj.replace(/[^0-9]/g, "").slice(0, 6),
            regularityStatus: regularityStatus || "green",
          })
          .returning();
      } else {
        [client] = await db
          .update(clients)
          .set({
            name: name || clientList[0].name,
            regularityStatus:
              regularityStatus || clientList[0].regularityStatus,
          })
          .where(eq(clients.cnpj, cnpj))
          .returning();
      }
      res.json({ success: true, client });
    },
  );

  // Update Billing
  app.post(
    "/api/integration/update-billing",
    verifyIntegrationToken,
    async (req, res) => {
      const { clientId, month, revenue, expenses, payroll } = req.body;
      const integrationClient = (req as any).integrationClient;

      // Segurança: O token de integração de um cliente só pode alterar o faturamento dele mesmo!
      if (clientId !== integrationClient.id) {
        return res.status(403).json({ error: "Acesso negado. Token não autorizado para este clientId." });
      }

      const existing = await db
        .select()
        .from(billingData)
        .where(eq(billingData.clientId, clientId));
      const target = existing.find((b) => b.month === month);

      if (target) {
        await db
          .update(billingData)
          .set({
            revenue,
            expenses,
            payroll,
          })
          .where(eq(billingData.id, target.id));
      } else {
        await db.insert(billingData).values({
          clientId,
          month,
          revenue,
          expenses,
          payroll,
        });
      }
      res.json({ success: true });
    },
  );

  // -------------------------------------------------------------
  // CLIENT VIEW ENDPOINTS
  // -------------------------------------------------------------

  app.get("/api/client/dashboard", verifyClientAuth, async (req, res) => {
    const clientId = (req as any).user.clientId;
    const clientList = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId));
    if (clientList.length === 0)
      return res.status(404).json({ error: "Client not found" });

    const client = clientList[0];
    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.clientId, clientId));
    const billing = await db
      .select()
      .from(billingData)
      .where(eq(billingData.clientId, clientId))
      .orderBy(asc(billingData.month));
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.clientId, clientId))
      .orderBy(desc(messages.createdAt));

    const serproConf = await db.select().from(serproConfig).limit(1);
    const whatsappSupport = serproConf[0]?.whatsappSupport || "";

    res.json({
      client,
      whatsappSupport,
      documents: docs.map((d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      })),
      billing,
      messages: msgs.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  });

  app.post("/api/client/setup-profile", verifyClientAuth, async (req, res) => {
    const clientId = (req as any).user.clientId;
    const { email, password } = req.body;

    const clientList = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId));
    if (clientList.length === 0)
      return res.status(404).json({ error: "Client not found" });

    const updateData: any = {
      email,
      firstAccessDone: true,
    };
    if (password) {
      updateData.passwordHash = password;
    }

    const [client] = await db
      .update(clients)
      .set(updateData)
      .where(eq(clients.id, clientId))
      .returning();

    // Send Welcome Email
    if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD && email) {
      try {
        const fromName = process.env.EMAIL_FROM_NAME || "Vírgula Contábil";
        const alias = process.env.EMAIL_ALIAS || process.env.EMAIL_USER;

        await transporter.sendMail({
          from: `"${fromName}" <${alias}>`,
          to: email,
          subject:
            "Bem-vindo(a) à Vírgula Contábil - Primeiro Acesso Confirmado",
          html: `
             <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
               <div style="background-color: #1f2937; padding: 20px; border-radius: 12px; text-align: center; margin-bottom: 20px;">
                  <h1 style="color: #fff; margin: 0;">Vírgula <span style="color: #10b981;">Contábil</span></h1>
               </div>
               <h2>Olá, ${client.name}!</h2>
               <p>Seu primeiro acesso ao nosso portal foi realizado com sucesso.</p>
               <p>Seu login é: <strong>${client.cnpj}</strong></p>
               <p>Agora você pode acompanhar as guias, envios de documentos e mural de recados pelo nosso sistema centralizado.</p>
               <p>Atenciosamente,<br>Equipe Vírgula Contábil</p>
             </div>
           `,
        });
      } catch (err) {
        console.error("Error sending welcome email:", err);
      }
    }

    res.json({ success: true, client });
  });

  app.post("/api/client/update-billing", verifyClientAuth, async (req, res) => {
    const clientId = (req as any).user.clientId;
    const {
      month,
      servicesRevenue,
      salesRevenue,
      totalIncomes,
      servicesTaken,
    } = req.body;

    try {
      const existing = await db
        .select()
        .from(billingData)
        .where(eq(billingData.clientId, clientId));
      const target = existing.find((b) => b.month === month);

      const updatePayload = {
        servicesRevenue: servicesRevenue || 0,
        salesRevenue: salesRevenue || 0,
        totalIncomes: totalIncomes || 0,
        servicesTaken: servicesTaken || 0,
        // Legacy fallback
        revenue: (servicesRevenue || 0) + (salesRevenue || 0),
        expenses: servicesTaken || 0,
        payroll: 0,
      };

      if (target) {
        await db
          .update(billingData)
          .set(updatePayload)
          .where(eq(billingData.id, target.id));
      } else {
        await db.insert(billingData).values({
          ...updatePayload,
          clientId,
          month,
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/client/bulk-billing", verifyClientAuth, async (req, res) => {
    const clientId = (req as any).user.clientId;
    const { data } = req.body; // Array of items

    try {
      for (const item of data) {
        const {
          month,
          servicesRevenue,
          salesRevenue,
          totalIncomes,
          servicesTaken,
        } = item;
        const existing = await db
          .select()
          .from(billingData)
          .where(eq(billingData.clientId, clientId));
        const target = existing.find((b) => b.month === month);

        const updatePayload = {
          servicesRevenue: servicesRevenue || 0,
          salesRevenue: salesRevenue || 0,
          totalIncomes: totalIncomes || 0,
          servicesTaken: servicesTaken || 0,
          // Legacy fallback
          revenue: (servicesRevenue || 0) + (salesRevenue || 0),
          expenses: servicesTaken || 0,
          payroll: 0,
        };

        if (target) {
          await db
            .update(billingData)
            .set(updatePayload)
            .where(eq(billingData.id, target.id));
        } else {
          await db.insert(billingData).values({
            ...updatePayload,
            clientId,
            month,
          });
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Upload file by client
  // Gerar Guia (DCTFWEB / PGDASD) SERPRO
  app.post(
    "/api/pendencies/guia/:clienteId",
    verifyAnyAuth,
    async (req, res) => {
      try {
        const clientId = req.params.clienteId;
        
        // 1. Validação de UUID
        if (!isUuid(clientId)) {
          return res.status(400).json({ error: "ID do cliente no formato inválido." });
        }

        const tokenClientId = (req as any).user?.clientId || (req as any).user?.id;
        const tokenRole = (req as any).user?.role;
        if (tokenRole === "client" && tokenClientId !== clientId) {
          return res.status(403).json({ error: "Acesso negado." });
        }

        const { tipoGuia, competencia, documentId } = req.body;

        if (!tipoGuia || !competencia) {
          return res
            .status(400)
            .json({ error: "tipoGuia e competencia são obrigatórios." });
        }

        // Integra Contador só é acionado para guias de INSS (DCTFWEB_INSS)
        // e Simples Nacional (DAS_SIMPLES). Outras categorias não são suportadas.
        const CATEGORIAS_INTEGRA_CONTADOR = ["DCTFWEB_INSS", "DAS_SIMPLES"] as const;
        if (!CATEGORIAS_INTEGRA_CONTADOR.includes(tipoGuia as any)) {
          return res.status(400).json({
            error: `Integra Contador não suporta a categoria "${tipoGuia}". Apenas INSS (DCTFWEB_INSS) e Simples Nacional (DAS_SIMPLES) são permitidos.`,
          });
        }

        if (!/^\d{6}$/.test(competencia)) {
          return res
            .status(400)
            .json({ error: "competencia deve ter formato AAAAMM." });
        }

        console.log("Processando requisição Integra Contador:", {
          tipoGuia,
          competencia,
          documentId,
          clientId,
        });

        const clientList = await db
          .select()
          .from(clients)
          .where(eq(clients.id, clientId));
        if (clientList.length === 0) {
          return res.status(404).json({ error: "Cliente não encontrado." });
        }

        const serproList = await db.select().from(serproConfig).limit(1);
        if (serproList.length === 0 || !serproList[0].consumerKey) {
           return res.status(400).json({ error: "Integra Contador não configurado. Acesse as configurações." });
        }
        const config = serproList[0];
        const cnpjContrato = config.cnpjContratante
            ? config.cnpjContratante.replace(/\D/g, "")
            : "00000000000100";

        const client = clientList[0];
        const anoPA = competencia.substring(0, 4);
        const mesPA = competencia.substring(4, 6);

        let payload;
        if (tipoGuia === "DCTFWEB_INSS") {
          payload = {
            contratante: { numero: cnpjContrato, tipo: 2 },
            autorPedidoDados: { numero: cnpjContrato, tipo: 2 },
            contribuinte: { numero: client.cnpj.replace(/\D/g, ""), tipo: 2 },
            pedidoDados: {
              idSistema: "DCTFWEB",
              idServico: "GERARGUIA31",
              versaoSistema: "1.0",
              dados: JSON.stringify({
                categoria: "GERAL_MENSAL",
                anoPA,
                mesPA,
              }),
            },
          };
        } else {
          payload = {
            contratante: { numero: cnpjContrato, tipo: 2 },
            autorPedidoDados: { numero: cnpjContrato, tipo: 2 },
            contribuinte: { numero: client.cnpj.replace(/\D/g, ""), tipo: 2 },
            pedidoDados: {
              idSistema: "PGDASD",
              idServico: "GERARDAS12",
              versaoSistema: "1.0",
              dados: JSON.stringify({ periodoApuracao: competencia }),
            },
          };
        }

        console.log(`[SERPRO API] Enviando POST /Emitir para tipo ${tipoGuia}`);
        
        let certAgent;
        if (config.ambiente === "producao") {
          if (!config.certPath) {
            return res.status(400).json({
              error: "Certificado digital nao configurado. Reenvie o arquivo .pfx/.p12 nas configuracoes do Integra Contador.",
            });
          }

          try {
            const pfx = await fs.promises.readFile(config.certPath);
            certAgent = new https.Agent({
              pfx,
              passphrase: config.certSenha || "",
              rejectUnauthorized: true,
            });
          } catch (err: any) {
            console.error("Certificado SERPRO configurado nao pode ser lido:", {
              path: config.certPath,
              code: err?.code,
              message: err?.message,
            });
            return res.status(400).json({
              error: "Certificado digital nao encontrado no servidor. Reenvie o arquivo .pfx/.p12 nas configuracoes do Integra Contador.",
            });
          }
        }

        let pdfBase64;
        let vencFormatado;
        let valorTotal;
        try {
          const tokens = await getSerproToken(config, certAgent);
          const baseUrl = config.ambiente === "producao"
            ? "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1"
            : "https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1";

          const apiResp = await serproPost(`${baseUrl}/Emitir`, tokens, payload, certAgent);
          if (!apiResp.ok) {
            const errBody = await apiResp.text();
            throw new Error(`SERPRO retornou ${apiResp.status}: ${errBody}`);
          }

          const text = await apiResp.text();
          const root = JSON.parse(text);

          // "dados" vem como string JSON escapada — faz parse duplo se necessário
          let dados = root.dados;
          if (typeof dados === "string") {
            try { dados = JSON.parse(dados); } catch (_) {}
          }

          if (tipoGuia === "DAS_SIMPLES") {
            // Resposta: array de objetos Das
            // { pdf, cnpjCompleto, detalhamentoDas: { dataVencimento, valores: { total } } }
            const das = Array.isArray(dados) ? dados[0] : dados;
            if (!das) throw new Error("SERPRO DAS: resposta sem dados.");
            pdfBase64 = das.pdf;
            const det = das.detalhamentoDas ?? das.detalhamento ?? {};
            // Data de vencimento da API é da guia original — ignora e usa data de emissão
            vencFormatado = null;
            valorTotal    = det.valores?.total ?? null;
          } else {
            // Resposta: { PDFByteArrayBase64: "..." }
            const dctf = typeof dados === "object" && dados !== null ? dados : {};
            pdfBase64  = dctf.PDFByteArrayBase64;
            if (!pdfBase64) throw new Error("SERPRO DCTFWEB: PDFByteArrayBase64 ausente na resposta.");
            // DCTFWEB não retorna vencimento/valor na resposta — mantém null para extrair do PDF
            vencFormatado = null;
            valorTotal    = null;
          }

          // Vencimento: usa a data de emissão (hoje), avança para próximo dia útil se cair em fds
          if (!vencFormatado) {
            const hoje = new Date();
            const dia = hoje.getDay(); // 0=dom, 6=sab
            const offset = dia === 6 ? 2 : dia === 0 ? 1 : 0;
            if (offset > 0) hoje.setDate(hoje.getDate() + offset);
            const yy = hoje.getFullYear();
            const mm = String(hoje.getMonth() + 1).padStart(2, "0");
            const dd = String(hoje.getDate()).padStart(2, "0");
            vencFormatado = `${yy}-${mm}-${dd}`;
            console.log(`[SERPRO API] Vencimento não retornado pela API, usando data de emissão: ${vencFormatado}`);
          }
          console.log(`[SERPRO API] Dados recebidos — vencimento: ${vencFormatado}, valor: ${valorTotal}`);
        } catch (e: any) {
          console.error("Erro ao comunicar com Integra Contador SERPRO:", e.message);
          throw e; // propaga — sem fallback mock para não enganar o usuário com dados falsos
        }

        if (!pdfBase64) {
          throw new Error("SERPRO não retornou PDF na resposta.");
        }

        const pdfBuffer = Buffer.from(pdfBase64, "base64");
        let pixCode: string | null = null;
        try {
          const { extractPixCodeFromPdf } = await import("./qrExtractor");
          pixCode = await extractPixCodeFromPdf(pdfBuffer);
        } catch (err) {
          console.warn("Nao foi possivel extrair o PIX do PDF da guia:", err);
        }

        if (!pixCode) {
          console.warn("[SERPRO API] Guia gerada sem PIX copia e cola extraido do PDF.");
        }

        let guiaId: number;
        let realFileUrl: string;

        // Executa escritas em transação Drizzle
        await db.transaction(async (tx) => {
          const insertedGuia = await tx
            .insert(guiasGeradas)
            .values({
              clientId: clientId,
              usuarioId: 1,
              tipoGuia: tipoGuia,
              competencia: competencia,
              status: "CONCLUIDO",
              dataVencimento: vencFormatado,
              valorTotal: valorTotal,
              pdfPath: "", // Atualizado abaixo
              createdAt: new Date(),
              concluidoAt: new Date(),
            })
            .returning();
            
          guiaId = insertedGuia[0].id;
          realFileUrl = `/api/pendencies/guia/${guiaId}/pdf`;

          // Salva PDF em disco de forma assíncrona
          const pdfDir = process.env.DATA_PATH 
            ? path.join(process.env.DATA_PATH, "guias_pdfs") 
            : path.join(process.cwd(), "data", "guias_pdfs");
          await fs.promises.mkdir(pdfDir, { recursive: true });
          
          const pdfFile = `guia_${tipoGuia}_${clientId}_${competencia}_${guiaId}.pdf`;
          const pdfPath = path.join(pdfDir, pdfFile);
          await fs.promises.writeFile(pdfPath, pdfBuffer);
          
          await tx
            .update(guiasGeradas)
            .set({ pdfPath: pdfPath })
            .where(eq(guiasGeradas.id, guiaId));

          // Atualiza o documento original associado
          if (documentId && isUuid(documentId)) {
            await tx
              .update(documents)
              .set({
                dueDate: vencFormatado,
                fileUrl: realFileUrl,
                pixCode,
                status: "GUIA_ATUALIZADA",
              })
              .where(eq(documents.id, documentId));
          }
        });

        console.log(
          `[SERPRO API] Resposta processada com sucesso. Retornando guia.`
        );

        res.json({
          status: "CONCLUIDO",
          guiaId: guiaId!,
          dataVencimento: vencFormatado,
          valorTotal: valorTotal,
          pdfPath: realFileUrl!,
          pixCode,
        });
      } catch (e: any) {
        console.error("Erro no Integra Contador:", e);
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.get("/api/pendencies/guia/:guiaId/pdf", verifyAnyAuth, async (req, res) => {
    try {
      const guiaId = parseInt(req.params.guiaId);
      if (isNaN(guiaId)) {
        return res.status(400).send("ID da guia inválido.");
      }
      
      const guia = await db
        .select()
        .from(guiasGeradas)
        .where(eq(guiasGeradas.id, guiaId));
      if (guia.length === 0 || !guia[0].pdfPath) {
        return res.status(404).send("PDF não encontrado.");
      }

      // Segurança contra IDOR/BOLA: Se for cliente, valida se a guia é dele
      const tokenClientId = (req as any).user?.clientId;
      const tokenRole = (req as any).user?.role;
      if (tokenRole === "client" && guia[0].clientId !== tokenClientId) {
        return res.status(403).send("Acesso negado. Esta guia pertence a outro cliente.");
      }

      const pdfData = guia[0].pdfPath;
      if (pdfData.startsWith("data:application/pdf;base64,")) {
        const base64Data = pdfData.replace("data:application/pdf;base64,", "");
        const buffer = Buffer.from(base64Data, "base64");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename=guia_${guiaId}.pdf`,
        );
        return res.send(buffer);
      }
      
      // Valida assincronamente a existência do arquivo no disco
      try {
        await fs.promises.access(pdfData);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename=${path.basename(pdfData)}`,
        );
        const stream = fs.createReadStream(pdfData);
        stream.pipe(res);
      } catch {
        // Redireciona apenas se for uma URL HTTP válida
        if (pdfData.startsWith("http://") || pdfData.startsWith("https://")) {
          res.redirect(pdfData);
        } else {
          res.status(404).send("PDF não encontrado no disco.");
        }
      }
    } catch (e: any) {
      console.error(e);
      res.status(500).send("Erro ao baixar PDF");
    }
  });

  app.get(
    "/api/pendencies/guia/:clienteId/historico",
    verifyAnyAuth,
    async (req, res) => {
      try {
        const clientId = req.params.clienteId;

        const tokenClientId = (req as any).user?.clientId || (req as any).user?.id;
        const tokenRole = (req as any).user?.role;
        if (tokenRole === "client" && tokenClientId !== clientId) {
          return res.status(403).json({ error: "Acesso negado." });
        }

        const historico = await db
          .select()
          .from(guiasGeradas)
          .where(eq(guiasGeradas.clientId, clientId))
          .orderBy(desc(guiasGeradas.id))
          .limit(20);
        res.json({ success: true, historico });
      } catch (e: any) {
        console.error(e);
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.post(
    "/api/client/upload",
    verifyClientAuth,
    upload.single("file"),
    async (req, res) => {
      const clientId = (req as any).user.clientId;
      const { title, category, competence } = req.body;

      const [newDoc] = await db
        .insert(documents)
        .values({
          clientId,
          title: title || `Documento ${category}`,
          category,
          competence,
          fileUrl: req.file ? `/uploads/${req.file.filename}` : null,
          status: "new",
          uploadedBy: "client",
        })
        .returning();

      res.json({
        success: true,
        document: { ...newDoc, createdAt: newDoc.createdAt.toISOString() },
      });
    },
  );

  app.post("/api/client/mark-doc/:id", verifyClientAuth, async (req, res) => {
    const clientId = (req as any).user.clientId;
    const docId = req.params.id;
    const { status } = req.body;

    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.id, docId));
    if (docs.length > 0 && docs[0].clientId === clientId) {
      await db.update(documents).set({ status }).where(eq(documents.id, docId));
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Doc not found" });
    }
  });

  app.post("/api/client/message", verifyClientAuth, async (req, res) => {
    try {
      const clientId = (req as any).user.clientId;
      const { content } = req.body;

      const [newMsg] = await db
        .insert(messages)
        .values({
          clientId,
          content,
          direction: "client_to_accountant",
          read: false,
        })
        .returning();

      res.json({
        success: true,
        message: { ...newMsg, createdAt: newMsg.createdAt.toISOString() },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/client/preferences", verifyClientAuth, async (req, res) => {
    try {
      const clientId = (req as any).user.clientId;
      const { notificationPreferences } = req.body;

      await db.update(clients)
        .set({ notificationPreferences })
        .where(eq(clients.id, clientId));

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // -------------------------------------------------------------
  // ACCOUNTANT VIEW ENDPOINTS
  // -------------------------------------------------------------

  app.get("/api/accountant/clients", verifyAccountantAuth, async (req, res) => {
    const allClients = await db.select().from(clients);
    res.json({ clients: allClients });
  });

  app.get("/api/accountant/solicitacoes", verifyAccountantAuth, async (req, res) => {
    try {
      const pendingDocs = await db.select({
         id: documents.id,
         title: documents.title,
         category: documents.category,
         competence: documents.competence,
         dueDate: documents.dueDate,
         status: documents.status,
         createdAt: documents.createdAt,
         clientName: clients.name,
         clientCnpj: clients.cnpj
      }).from(documents)
      .leftJoin(clients, eq(documents.clientId, clients.id))
      .where(eq(documents.status, 'waiting_accountant'));

      res.json({ solicitacoes: pendingDocs });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post(
    "/api/accountant/solicitacoes/:id",
    verifyAccountantAuth,
    upload.single("file"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { dueDate, valor } = req.body;

        if (!req.file) {
          return res.status(400).json({ error: "Arquivo é obrigatório" });
        }

        const filePath = `/uploads/${req.file.filename}`;

        // Get document to find client id
        const docs = await db.select().from(documents).where(eq(documents.id, id));
        if (docs.length === 0) {
          return res.status(404).json({ error: "Documento não encontrado" });
        }
        const doc = docs[0];

        let extractedValue = parseFloat(valor);
        let extractedData = doc.extractedData || {};
        if (typeof extractedData !== 'object' || Array.isArray(extractedData)) {
            extractedData = { original: extractedData };
        }
        if (!isNaN(extractedValue)) {
            (extractedData as any).extractedValue = extractedValue;
        }

        const [updatedDoc] = await db
          .update(documents)
          .set({
            fileUrl: filePath,
            dueDate: dueDate || doc.dueDate,
            status: "GUIA_ATUALIZADA",
            extractedData,
          })
          .where(eq(documents.id, id))
          .returning();

        // Trigger on_file_available notification logic here for this document
        const rules = await db.select().from(scheduledNotifications)
          .where(eq(scheduledNotifications.type, 'on_file_available'));
        
        for (const rule of rules) {
          if (!rule.clientId || rule.clientId === doc.clientId) {
            let title = (rule.title || "Nova Guia Disponível").replace(/\[NOME_GUIA\]/g, doc.title).replace(/\[CATEGORIA\]/g, doc.category);
            let body = (rule.body || "").replace(/\[NOME_GUIA\]/g, doc.title)
                                         .replace(/\[CATEGORIA\]/g, doc.category)
                                         .replace(/\[VENCIMENTO\]/g, updatedDoc.dueDate || "N/A");
            
            await sendClientNotification(doc.clientId, title, body);
          }
        }

        res.json({ success: true, document: updatedDoc });
      } catch (e: any) {
        console.error("Erro ao resolver solicitação:", e);
        res.status(500).json({ error: e.message });
      }
    }
  );

  app.post(
    "/api/accountant/clients",
    verifyAccountantAuth,
    async (req, res) => {
      const {
        cnpj,
        name,
        regularityStatus,
        integrationHash,
        accountantCategory,
      } = req.body;
      try {
        const [newClient] = await db
          .insert(clients)
          .values({
            cnpj,
            name,
            passwordHash: cnpj,
            regularityStatus: regularityStatus || "green",
            integrationHash: integrationHash || null,
            accountantCategory: accountantCategory || null,
          })
          .returning();
        res.json({ success: true, client: newClient });
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    },
  );


  app.post(
    "/api/accountant/client/:id/reset-password",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        const { id } = req.params;
        const clientList = await db.select().from(clients).where(eq(clients.id, id));
        if (clientList.length === 0) {
          return res.status(404).json({ error: "Cliente não encontrado" });
        }
        
        const client = clientList[0];
        const cleanCnpj = client.cnpj.replace(/\D/g, "");
        
        await db.update(clients)
          .set({ 
             passwordHash: cleanCnpj,
             firstAccessDone: false
          })
          .where(eq(clients.id, id));
          
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    }
  );

  app.put(
    "/api/accountant/client/:id",
    verifyAccountantAuth,
    async (req, res) => {
      const { name, regularityStatus, integrationHash, accountantCategory } =
        req.body;
      try {
        const [updated] = await db
          .update(clients)
          .set({
            name,
            regularityStatus,
            integrationHash: integrationHash || null,
            accountantCategory: accountantCategory || null,
          })
          .where(eq(clients.id, req.params.id))
          .returning();
        res.json({ success: true, client: updated });
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.delete(
    "/api/accountant/client/:id",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        const clientId = req.params.id;
        // Delete dependencies
        await db.delete(guiasGeradas).where(eq(guiasGeradas.clientId, clientId));
        await db.delete(scheduledNotifications).where(eq(scheduledNotifications.clientId, clientId));
        await db.delete(subscriptions).where(eq(subscriptions.clientId, clientId));
        await db.delete(documents).where(eq(documents.clientId, clientId));
        await db.delete(billingData).where(eq(billingData.clientId, clientId));
        await db.delete(messages).where(eq(messages.clientId, clientId));

        // Delete client
        await db.delete(clients).where(eq(clients.id, clientId));
        res.json({ success: true });
      } catch (e: any) {
        console.error(e);
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.get(
    "/api/accountant/client/:id",
    verifyAccountantAuth,
    async (req, res) => {
      const clientId = req.params.id;
      const clientList = await db
        .select()
        .from(clients)
        .where(eq(clients.id, clientId));
      if (clientList.length === 0)
        return res.status(404).json({ error: "Client not found" });

      const client = clientList[0];
      const docs = await db
        .select()
        .from(documents)
        .where(eq(documents.clientId, clientId));
      const msgs = await db
        .select()
        .from(messages)
        .where(eq(messages.clientId, clientId));
      const billing = await db
        .select()
        .from(billingData)
        .where(eq(billingData.clientId, clientId));

      res.json({
        client,
        documents: docs.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
        })),
        messages: msgs.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
        })),
        billing,
      });
    },
  );

  app.get(
    "/api/accountant/files/stats",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        const allDocs = await db.select().from(documents);
        let totalSize = 0;
        for (const doc of allDocs) {
          if (doc.fileUrl) {
            if (doc.fileUrl.startsWith("data:")) {
              const base64str = doc.fileUrl.split(",")[1];
              if (base64str) {
                totalSize += Math.floor((base64str.length * 3) / 4);
              }
            } else if (doc.fileUrl.startsWith("/uploads/")) {
              const filePath = path.join(process.cwd(), doc.fileUrl);
              try {
                if (fs.existsSync(filePath)) {
                  const stat = fs.statSync(filePath);
                  totalSize += stat.size;
                }
              } catch (e) {}
            }
          }
        }
        res.json({ totalSize });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.get("/api/accountant/files", verifyAccountantAuth, async (req, res) => {
    try {
      const allDocs = await db
        .select()
        .from(documents)
        .orderBy(desc(documents.createdAt));
      const allClients = await db.select().from(clients);

      const filesWithMetadata = allDocs.map((doc) => {
        const cl = allClients.find((c) => c.id === doc.clientId);
        let size = 0;

        if (doc.fileUrl) {
          if (doc.fileUrl.startsWith("data:")) {
            const base64str = doc.fileUrl.split(",")[1];
            if (base64str) {
              size = Math.floor((base64str.length * 3) / 4);
            }
          } else if (doc.fileUrl.startsWith("/uploads/")) {
            const filePath = path.join(process.cwd(), doc.fileUrl);
            try {
              if (fs.existsSync(filePath)) {
                const stat = fs.statSync(filePath);
                size = stat.size;
              }
            } catch (e) {}
          }
        }

        return {
          id: doc.id,
          title: doc.title,
          category: doc.category,
          status: doc.status,
          createdAt: doc.createdAt.toISOString(),
          fileUrl: doc.fileUrl,
          size,
          clientName: cl?.name || "Desconhecido",
          clientId: doc.clientId,
          uploadedBy: doc.uploadedBy,
        };
      });

      res.json({ files: filesWithMetadata });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete(
    "/api/accountant/files/bulk",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        const { fileIds } = req.body;
        if (!Array.isArray(fileIds) || fileIds.length === 0) {
          return res.status(400).json({ error: "Nenhum arquivo selecionado" });
        }

        const docsToDelete = await db
          .select()
          .from(documents)
          .where(inArray(documents.id, fileIds));

        for (const doc of docsToDelete) {
          if (doc.fileUrl && doc.fileUrl.startsWith("/uploads/")) {
            const filePath = path.join(process.cwd(), doc.fileUrl);
            try {
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
            } catch (e) {}
          }
        }

        await db.delete(documents).where(inArray(documents.id, fileIds));
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.get("/api/accountant/inbox", verifyAccountantAuth, async (req, res) => {
    const allDocs = await db
      .select()
      .from(documents)
      .where(or(eq(documents.uploadedBy, "client"), eq(documents.status, "waiting_accountant")))
      .orderBy(desc(documents.createdAt));
    const allClients = await db.select().from(clients);

    const inboxDocs = allDocs.map((doc) => {
      const cl = allClients.find((c) => c.id === doc.clientId);
      return {
        ...doc,
        createdAt: doc.createdAt.toISOString(),
        clientName: cl?.name || "Desconhecido",
      };
    });

    res.json({ docs: inboxDocs });
  });

  app.post(
    "/api/accountant/upload-doc",
    verifyAccountantAuth,
    upload.single("file"),
    async (req, res) => {
      const { clientId, title, category, dueDate, competence } = req.body;

      const [newDoc] = await db
        .insert(documents)
        .values({
          clientId,
          title,
          category,
          dueDate,
          competence,
          fileUrl: req.file ? `/uploads/${req.file.filename}` : null,
          status: "new",
          uploadedBy: "accountant",
        })
        .returning();

      res.json({
        success: true,
        document: { ...newDoc, createdAt: newDoc.createdAt.toISOString() },
      });
    },
  );

  app.put(
    "/api/accountant/document/:id",
    verifyAccountantAuth,
    upload.single("file"),
    async (req, res) => {
      try {
        const docId = req.params.id;
        const { title, category, dueDate, competence, status, valor } = req.body;

        const docList = await db.select().from(documents).where(eq(documents.id, docId));
        if (docList.length === 0) {
          return res.status(404).json({ error: "Documento não encontrado" });
        }
        
        const currentDoc = docList[0];
        
        let extractedData = currentDoc.extractedData as any || {};
        if (valor !== undefined && valor !== "") {
           extractedData = { ...extractedData, extractedValue: parseFloat(valor) };
        }

        const updateData: any = {
          title: title || currentDoc.title,
          category: category || currentDoc.category,
          dueDate: dueDate || currentDoc.dueDate,
          competence: competence || currentDoc.competence,
          status: status || currentDoc.status,
          extractedData
        };

        let fileReplaced = false;
        if (req.file) {
          updateData.fileUrl = `/uploads/${req.file.filename}`;
          fileReplaced = true;
        }

        const [updated] = await db
          .update(documents)
          .set(updateData)
          .where(eq(documents.id, docId))
          .returning();

        if (fileReplaced) {
          // Check client preferences
          const [clientRecord] = await db.select().from(clients).where(eq(clients.id, currentDoc.clientId));
          if (clientRecord && clientRecord.notificationPreferences) {
            const prefs = clientRecord.notificationPreferences as any;
            if (prefs.receives_all && prefs.on_new_file) {
              await db.insert(messages).values({
                clientId: currentDoc.clientId,
                content: `O documento **${updated.title || 'Guia'}** foi atualizado/substituído pelo contador.`,
                direction: "accountant_to_client"
              });
            }
          }
        }

        res.json({ success: true, document: updated });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/accountant/message",
    verifyAccountantAuth,
    async (req, res) => {
      const { clientId, content } = req.body;

      await db.insert(messages).values({
        clientId,
        content,
        read: false,
      });

      res.json({ success: true });
    },
  );

  app.post(
    "/api/accountant/message/bulk",
    verifyAccountantAuth,
    async (req, res) => {
      const { clientIds, content } = req.body;

      if (!Array.isArray(clientIds) || clientIds.length === 0) {
        return res.status(400).json({ error: "Nenhum cliente selecionado" });
      }

      const newMessages = clientIds.map((id: string) => ({
        clientId: id,
        content,
        read: false,
      }));

      await db.insert(messages).values(newMessages);
      res.json({ success: true });
    },
  );

  app.post(
    "/api/accountant/document/:id/status",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        const { status } = req.body;
        await db
          .update(documents)
          .set({ status })
          .where(eq(documents.id, req.params.id));
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.delete(
    "/api/accountant/message/:id",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        await db.delete(messages).where(eq(messages.id, req.params.id));
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.put(
    "/api/accountant/message/:id",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        const { content } = req.body;
        await db
          .update(messages)
          .set({ content })
          .where(eq(messages.id, req.params.id));
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.post(
    "/api/accountant/client/:id/generate-token",
    verifyAccountantAuth,
    async (req, res) => {
      const clientId = req.params.id;
      const clientList = await db
        .select()
        .from(clients)
        .where(eq(clients.id, clientId));
      if (clientList.length === 0)
        return res.status(404).json({ error: "Client not found" });

      const newToken = "hash_" + uuidv4().replace(/-/g, "");
      await db
        .update(clients)
        .set({ integrationHash: newToken })
        .where(eq(clients.id, clientId));

      res.json({ token: newToken });
    },
  );

  app.post(
    "/api/accountant/client/:id/revoke-token",
    verifyAccountantAuth,
    async (req, res) => {
      const clientId = req.params.id;
      const clientList = await db
        .select()
        .from(clients)
        .where(eq(clients.id, clientId));
      if (clientList.length === 0)
        return res.status(404).json({ error: "Client not found" });

      await db
        .update(clients)
        .set({ integrationHash: null })
        .where(eq(clients.id, clientId));

      res.json({ success: true });
    },
  );

  // Webhook for External System Integration
  app.post(
    "/api/webhook/documentos",
    upload.single("arquivo"),
    async (req, res) => {
      try {
        let companyHash, categoria, nomeArquivo, dataVencimento;
        let arquivoBase64 = null;

        if (req.file) {
          // multipart/form-data
          companyHash = req.body.companyHash;
          categoria = req.body.categoria || "Outros";
          nomeArquivo = req.body.nomeArquivo || req.file.originalname;
          dataVencimento = req.body.dataVencimento;
          arquivoBase64 =
            "data:" +
            req.file.mimetype +
            ";base64," +
            req.file.buffer.toString("base64");
        } else {
          // JSON
          companyHash = req.body.companyHash;
          categoria = req.body.categoria || "Outros";
          nomeArquivo = req.body.nomeArquivo || "Documento Integrado";
          dataVencimento = req.body.dataVencimento;
          if (req.body.arquivo) {
            arquivoBase64 = String(req.body.arquivo).startsWith("data:")
              ? req.body.arquivo
              : "data:application/pdf;base64," + req.body.arquivo;
          }
        }

        if (!companyHash) {
          return res
            .status(400)
            .json({ error: "O parâmetro companyHash é obrigatório" });
        }

        const clientList = await db
          .select()
          .from(clients)
          .where(eq(clients.integrationHash, companyHash));
        if (clientList.length === 0) {
          return res
            .status(404)
            .json({ error: "Empresa não encontrada para este hash" });
        }

        const targetClient = clientList[0];

        let finalFileUrl = null;
        if (arquivoBase64) {
           const match = arquivoBase64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
           if (match) {
              const buffer = Buffer.from(match[2], 'base64');
              const safeFilename = `${Date.now()}_${nomeArquivo || "documento.pdf"}`;
              const filePath = path.join(UPLOADS_DIR, safeFilename);
              fs.writeFileSync(filePath, buffer);
              finalFileUrl = `/uploads/${safeFilename}`;
           }
        }

        // Create document
        const [newDoc] = await db
          .insert(documents)
          .values({
            clientId: targetClient.id,
            title: nomeArquivo,
            category: categoria,
            dueDate: dataVencimento || null,
            status: "new",
            uploadedBy: "accountant",
            fileUrl: finalFileUrl,
          })
          .returning();

        return res.status(201).json({
          success: true,
          message: "Documento salvo com sucesso",
          documentId: newDoc.id,
        });
      } catch (e: any) {
        console.error("Webhook Erro:", e);
        return res
          .status(500)
          .json({ error: "Erro interno no servidor webhook: " + e.message });
      }
    },
  );

  // Accountant update billing for client
  app.post(
    "/api/accountant/client/:id/update-billing",
    verifyAccountantAuth,
    async (req, res) => {
      const clientId = req.params.id;
      const {
        month,
        servicesRevenue,
        salesRevenue,
        totalIncomes,
        servicesTaken,
      } = req.body;

      try {
        const existing = await db
          .select()
          .from(billingData)
          .where(eq(billingData.clientId, clientId));
        const target = existing.find((b) => b.month === month);

        const updatePayload = {
          servicesRevenue: servicesRevenue || 0,
          salesRevenue: salesRevenue || 0,
          totalIncomes: totalIncomes || 0,
          servicesTaken: servicesTaken || 0,
          // Legacy fallback
          revenue: (servicesRevenue || 0) + (salesRevenue || 0),
          expenses: servicesTaken || 0,
          payroll: 0,
        };

        if (target) {
          await db
            .update(billingData)
            .set(updatePayload)
            .where(eq(billingData.id, target.id));
        } else {
          await db.insert(billingData).values({
            ...updatePayload,
            clientId,
            month,
          });
        }
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  // Accountant bulk billing upload for client
  app.post(
    "/api/accountant/client/:id/bulk-billing",
    verifyAccountantAuth,
    async (req, res) => {
      const clientId = req.params.id;
      const { data } = req.body; // Array of items

      try {
        for (const item of data) {
          const {
            month,
            servicesRevenue,
            salesRevenue,
            totalIncomes,
            servicesTaken,
          } = item;
          const existing = await db
            .select()
            .from(billingData)
            .where(eq(billingData.clientId, clientId));
          const target = existing.find((b) => b.month === month);

          const updatePayload = {
            servicesRevenue: servicesRevenue || 0,
            salesRevenue: salesRevenue || 0,
            totalIncomes: totalIncomes || 0,
            servicesTaken: servicesTaken || 0,
            // Legacy fallback
            revenue: (servicesRevenue || 0) + (salesRevenue || 0),
            expenses: servicesTaken || 0,
            payroll: 0,
          };

          if (target) {
            await db
              .update(billingData)
              .set(updatePayload)
              .where(eq(billingData.id, target.id));
          } else {
            await db.insert(billingData).values({
              ...updatePayload,
              clientId,
              month,
            });
          }
        }
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.get("/api/vapidPublicKey", (req, res) => {
    res.send(vapidKeys.publicKey);
  });

  // SERPRO config
  app.get(
    "/api/pendencies/sitfis/config",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        let config = await db
          .select()
          .from(serproConfig)
          .where(eq(serproConfig.usuarioId, 1))
          .limit(1);
        if (config.length === 0) {
          return res.json({ success: true, config: null });
        }

        const certPath = config[0].certPath;
        let certExists = false;
        if (certPath) {
          try {
            await fs.promises.access(certPath, fs.constants.R_OK);
            certExists = true;
          } catch {
            certExists = false;
          }
        }
        
        // Sanitiza dados confidenciais antes de retornar
        const sanitizedConfig = {
          id: config[0].id,
          usuarioId: config[0].usuarioId,
          consumerKey: config[0].consumerKey,
          cnpjContratante: config[0].cnpjContratante,
          ambiente: config[0].ambiente,
          whatsappSupport: config[0].whatsappSupport,
          multipleFilesText: config[0].multipleFilesText,
          updatedAt: config[0].updatedAt,
          hasSecret: !!config[0].consumerSecret,
          hasCert: certExists,
          certMissing: !!certPath && !certExists,
          hasCertSenha: !!config[0].certSenha,
        };
        
        res.json({ success: true, config: sanitizedConfig });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.post(
    "/api/pendencies/sitfis/config",
    verifyAccountantAuth,
    uploadCert.single("cert"),
    async (req, res) => {
      try {
        const {
          consumerKey,
          consumerSecret,
          certSenha,
          cnpjContratante,
          ambiente,
          whatsappSupport,
          multipleFilesText,
        } = req.body;

        const updateData: any = {
          consumerKey,
          consumerSecret,
          cnpjContratante,
          ambiente,
          whatsappSupport,
          multipleFilesText,
        };

        if (certSenha) updateData.certSenha = certSenha;
        if (req.file) updateData.certPath = req.file.path;

        let config = await db
          .select()
          .from(serproConfig)
          .where(eq(serproConfig.usuarioId, 1))
          .limit(1);

        // Se houver certificado anterior no banco e um novo arquivo foi enviado, exclui o anterior
        if (config.length > 0 && config[0].certPath && req.file) {
          try {
            await fs.promises.unlink(config[0].certPath);
            console.log("Certificado anterior excluído com sucesso:", config[0].certPath);
          } catch (err) {
            console.error("Falha ao excluir certificado anterior:", err);
          }
        }

        if (config.length === 0) {
          await db.insert(serproConfig).values({
            usuarioId: 1,
            ...updateData,
          });
        } else {
          await db
            .update(serproConfig)
            .set(updateData)
            .where(eq(serproConfig.id, config[0].id));
        }

        res.json({ success: true });
      } catch (e: any) {
        console.error("ERRO SERPRO POST:", e);
        res
          .status(500)
          .json({ error: e.message, stack: e.stack, detail: e.toString() });
      }
    },
  );

  app.post(
    "/api/notifications/subscribe",
    verifyClientAuth,
    async (req, res) => {
      try {
        const clientId = (req as any).user.clientId;
        const { subscriptionObject, fcmToken, deviceName } = req.body;

        await db.insert(subscriptions).values({
          clientId,
          subscriptionObject,
          fcmToken,
          deviceName: deviceName || "Dispositivo",
        });
        res.status(201).json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.post(
    "/api/admin/notifications/send",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        const { userIds, title, body } = req.body;

        let subs = [];
        if (userIds && userIds.length > 0) {
          subs = await db
            .select()
            .from(subscriptions)
            .where(inArray(subscriptions.clientId, userIds));
        } else {
          subs = await db.select().from(subscriptions);
        }

        const payload = JSON.stringify({ title, body });

        const promises = subs.map(async (sub) => {
          const pushes = [];

          // 1. Web Push (PWA/Browser)
          if (sub.subscriptionObject) {
            pushes.push(
              webpush
                .sendNotification(
                  sub.subscriptionObject as webpush.PushSubscription,
                  payload,
                )
                .catch((err) => {
                  console.error("Error sending Web Push to sub:", sub.id, err);
                  // Remove invalid subscriptions
                  if (err.statusCode === 410 || err.statusCode === 404) {
                    return db
                      .delete(subscriptions)
                      .where(eq(subscriptions.id, sub.id));
                  }
                })
            );
          }

          // 2. Firebase Cloud Messaging (Capacitor Android/iOS app)
          if (sub.fcmToken && getApps().length > 0) {
            pushes.push(
              getMessaging().send({
                token: sub.fcmToken,
                notification: {
                  title,
                  body,
                },
                data: {
                  // Can add extra payload data here if needed
                  click_action: "FLUTTER_NOTIFICATION_CLICK"
                }
              }).catch(err => {
                console.error("Error sending FCM to sub:", sub.id, err);
                // Handle invalid tokens if needed (err.code === 'messaging/invalid-registration-token')
              })
            );
          }

          return Promise.all(pushes);
        });

        await Promise.all(promises);
        res.status(200).json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.get(
    "/api/admin/notifications/scheduled",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        const list = await db
          .select()
          .from(scheduledNotifications)
          .orderBy(desc(scheduledNotifications.createdAt));
        res.json({ success: true, list });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.post(
    "/api/admin/notifications/schedule",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        const { clientId, type, title, body, scheduleDay, scheduleTime } = req.body;
        if (!type || !title || !body) {
          return res.status(400).json({ error: "Campos obrigatórios: type, title, body" });
        }

        const [newRule] = await db
          .insert(scheduledNotifications)
          .values({
            clientId: clientId || null,
            type,
            title,
            body,
            scheduleDay: scheduleDay ? parseInt(scheduleDay) : null,
            scheduleTime: scheduleTime || null,
            active: true,
          })
          .returning();

        res.json({ success: true, rule: newRule });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.delete(
    "/api/admin/notifications/scheduled/:id",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        const ruleId = parseInt(req.params.id);
        if (isNaN(ruleId)) {
          return res.status(400).json({ error: "ID inválido" });
        }
        await db
          .delete(scheduledNotifications)
          .where(eq(scheduledNotifications.id, ruleId));
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );
}

// Background sweeper for notifications
let lastSweepDate = "";

function parseDueDateString(dateStr: string) {
  if (!dateStr) return null;
  try {
    if (dateStr.includes("/")) {
      const [day, month, year] = dateStr.split("/").map(Number);
      return new Date(year, month - 1, day);
    } else if (dateStr.includes("-")) {
      const parts = dateStr.split("T")[0].split("-");
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }
    return new Date(dateStr);
  } catch (e) {
    return null;
  }
}

function getDaysDiff(dueDateStr: string, today: Date) {
  const parsedDue = parseDueDateString(dueDateStr);
  if (!parsedDue) return -999;
  
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dueStart = new Date(parsedDue.getFullYear(), parsedDue.getMonth(), parsedDue.getDate());
  return differenceInDays(dueStart, todayStart);
}

async function sendPushToClients(clientId: string | null, title: string, body: string) {
  try {
    let subs = [];
    if (clientId) {
      subs = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.clientId, clientId));
    } else {
      subs = await db.select().from(subscriptions);
    }

    const payload = JSON.stringify({ title, body });
    const promises = subs.map(async (sub) => {
      const pushes = [];
      
      if (sub.subscriptionObject) {
        pushes.push(
          webpush
            .sendNotification(
              sub.subscriptionObject as webpush.PushSubscription,
              payload,
            )
            .catch((err) => {
              console.error("Error sending push in sweep to sub:", sub.id, err);
              if (err.statusCode === 410 || err.statusCode === 404) {
                return db
                  .delete(subscriptions)
                  .where(eq(subscriptions.id, sub.id));
              }
            })
        );
      }
      
      if (sub.fcmToken && getApps().length > 0) {
        pushes.push(
          getMessaging().send({
            token: sub.fcmToken,
            notification: { title, body }
          }).catch(err => console.error("Error sending FCM sweep", err))
        );
      }
      
      return Promise.all(pushes);
    });
    await Promise.all(promises);
  } catch (err) {
    console.error("Erro ao enviar push via sweeper:", err);
  }
}

async function runNotificationSweeper() {
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");

  const brTimeStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);
  
  console.log(`[Notification Sweeper] Iniciando varredura (Hora BSB: ${brTimeStr})`);
  try {
    const activeRules = await db
      .select()
      .from(scheduledNotifications)
      .where(eq(scheduledNotifications.active, true));

    for (const rule of activeRules) {
      if (rule.scheduleTime && brTimeStr < rule.scheduleTime) {
        continue;
      }
      
      const lastSent = rule.lastSent;
      const alreadySentToday = lastSent && format(lastSent, "yyyy-MM-dd") === todayStr;
      
      if (alreadySentToday) continue;

      let sentAny = false;

      if (rule.type === "recurrent") {
        if (rule.scheduleDay && now.getDate() === rule.scheduleDay) {
           console.log(`[Notification Sweeper] Disparando lembrete recorrente "${rule.title}"`);
           await sendPushToClients(rule.clientId, rule.title, rule.body);
           sentAny = true;
        }
      } else if (rule.type === "3_days_before" || rule.type === "on_due_date") {
        const targetDays = rule.type === "3_days_before" ? 3 : 0;
        
        let query;
        if (rule.clientId) {
          query = db
            .select()
            .from(documents)
            .where(eq(documents.clientId, rule.clientId));
        } else {
          query = db
            .select()
            .from(documents);
        }
        
        const docs = await query;
        for (const doc of docs) {
          if (doc.status === "paid" || !doc.dueDate) continue;
          
          const diff = getDaysDiff(doc.dueDate, now);
          if (diff === targetDays) {
            const dynamicBody = rule.body
              .replace(/\[NOME_GUIA\]/g, doc.title)
              .replace(/\[VENCIMENTO\]/g, doc.dueDate);
              
            const dynamicTitle = rule.title
              .replace(/\[NOME_GUIA\]/g, doc.title)
              .replace(/\[VENCIMENTO\]/g, doc.dueDate);

            console.log(`[Notification Sweeper] Enviando alerta para guia "${doc.title}" (vence em ${diff} dias)`);
            await sendPushToClients(doc.clientId, dynamicTitle, dynamicBody);
            sentAny = true;
          }
        }
      } else {
        // Para tipos não mapeados aqui
      }

      if (sentAny) {
         await db
           .update(scheduledNotifications)
           .set({ lastSent: now })
           .where(eq(scheduledNotifications.id, rule.id));
      } else if (rule.type !== "recurrent" || now.getDate() !== rule.scheduleDay) {
         // Para 3_days_before/on_due_date que não enviaram nada hoje, nós podemos
         // ou marcar como verificado hoje para não rodar de novo na próxima meia hora,
         // ou não marcar e deixar rodar depois. Se deixarmos rodar depois, 
         // se alguém enviar uma nova guia, ela pode ser pega! Isso é bom.
         // Porém, pra não imprimir o log toda hora, maybe it's fine.
      }
    }
  } catch (err) {
    console.error("[Notification Sweeper] Falha na execução da varredura:", err);
  }
}

// Executa a varredura a cada 30 minutos
setInterval(() => {
  runNotificationSweeper().catch(console.error);
}, 30 * 60 * 1000);

// Executa logo após a inicialização
setTimeout(() => {
  runNotificationSweeper().catch(console.error);
}, 10000);