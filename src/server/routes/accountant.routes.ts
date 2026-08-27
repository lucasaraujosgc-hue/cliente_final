import { Express } from "express";
import fs from "fs";
import { eq, desc, inArray, or } from "drizzle-orm";
import { db } from "../db";
import {
  clients,
  documents,
  billingData,
  messages,
  subscriptions,
  guiasGeradas,
  serproConfig,
  scheduledNotifications,
  auditLog,
} from "../schema";
import { upload, uploadCert, validateUploadedFileContent } from "../services/upload";
import { resolveUploadPath } from "../services/files";
import { encryptSecret, encryptBytes } from "../services/secretbox";
import { hashPassword } from "../services/password";
import { triggerDebouncedDocumentNotification } from "../services/notificationSweeper";
import { upsertBilling } from "../services/billing";
import { logAudit } from "../services/audit";
import {
  generateIntegrationToken,
  setIntegrationToken,
  clearIntegrationToken,
} from "../services/integrationToken";
import { clientAdminDTO } from "../dto/client";
import { normalizeCnpj } from "../../lib/cnpj";
import { verifyAccountantAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import {
  accountantCreateClientSchema,
  accountantUpdateClientSchema,
  accountantMessageSchema,
  accountantBulkMessageSchema,
  accountantEditMessageSchema,
  accountantUploadDocSchema,
  accountantUpdateDocSchema,
  accountantResolveSolicitacaoSchema,
  docStatusSchema,
  serproConfigSchema,
  billingUpdateSchema,
  billingBulkSchema,
} from "../schemas/validation";

// Best-effort on-disk / inline size of a stored document, for the gallery
// totals. Never throws, never touches a path outside the uploads dir, never
// blocks the event loop.
async function fileSizeFor(fileUrl: string | null): Promise<number> {
  if (!fileUrl) return 0;
  if (fileUrl.startsWith("data:")) {
    const b64 = fileUrl.split(",")[1];
    return b64 ? Math.floor((b64.length * 3) / 4) : 0;
  }
  const abs = resolveUploadPath(fileUrl);
  if (!abs) return 0;
  try {
    return (await fs.promises.stat(abs)).size;
  } catch {
    return 0;
  }
}

// Routes used by the accountant-facing admin panel: client CRUD, file
// management, inbox/messages, billing, and SERPRO integration settings.
export function registerAccountantRoutes(app: Express) {
  app.get("/api/accountant/clients", verifyAccountantAuth, async (req, res) => {
    const allClients = await db.select().from(clients);
    res.json({ clients: allClients.map(clientAdminDTO) });
  });

  // High-level counters for the accountant home screen.
  app.get("/api/accountant/overview", verifyAccountantAuth, async (req, res) => {
    try {
      const [allClients, allDocs] = await Promise.all([
        db.select().from(clients),
        db.select().from(documents),
      ]);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const in7 = new Date(today);
      in7.setDate(in7.getDate() + 7);

      const parseDue = (s: string | null) => {
        if (!s) return null;
        const iso = s.includes("/")
          ? s.split("/").reverse().join("-")
          : s.split("T")[0];
        const d = new Date(iso);
        return isNaN(d.getTime()) ? null : d;
      };

      let overdue = 0;
      let dueSoon = 0;
      for (const d of allDocs) {
        if (d.status === "paid") continue;
        const due = parseDue(d.dueDate);
        if (!due) continue;
        if (due < today) overdue++;
        else if (due <= in7) dueSoon++;
      }

      res.json({
        clients: allClients.length,
        clientsIrregular: allClients.filter((c) => c.regularityStatus !== "green").length,
        inbox: allDocs.filter(
          (d) => d.uploadedBy === "client" || d.status === "waiting_accountant",
        ).length,
        waitingRecalc: allDocs.filter((d) => d.status === "waiting_accountant").length,
        overdue,
        dueSoon,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/accountant/audit", verifyAccountantAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const rows = await db
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(limit);
      res.json({ entries: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
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
    validateUploadedFileContent,
    validateBody(accountantResolveSolicitacaoSchema),
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

        // Trigger debounced notification
        triggerDebouncedDocumentNotification(updatedDoc);

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
    validateBody(accountantCreateClientSchema),
    async (req, res) => {
      const {
        cnpj,
        name,
        regularityStatus,
        integrationHash,
        accountantCategory,
      } = req.body;
      try {
        const cnpjDigits = normalizeCnpj(cnpj);
        if (cnpjDigits.length < 11) {
          return res.status(400).json({ error: "CNPJ inválido." });
        }
        const [newClient] = await db
          .insert(clients)
          .values({
            cnpj: cnpjDigits,
            name,
            // Default password is the client's own CNPJ (digits-only); they're
            // expected to change it on first access. bcrypt hash, never plaintext.
            passwordHash: await hashPassword(cnpjDigits),
            regularityStatus: regularityStatus || "green",
            // A pasted integration token is stored hashed, never in plaintext.
            ...(typeof integrationHash === "string" && integrationHash.trim()
              ? setIntegrationToken(integrationHash.trim())
              : {}),
            accountantCategory: accountantCategory || null,
          })
          .returning();
        await logAudit(req, "client.create", {
          targetType: "client",
          targetId: newClient.id,
          summary: `Criou o cliente ${newClient.name} (${newClient.cnpj})`,
        });
        res.json({ success: true, client: clientAdminDTO(newClient) });
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
             passwordHash: await hashPassword(cleanCnpj),
             firstAccessDone: false
          })
          .where(eq(clients.id, id));

        await logAudit(req, "client.reset_password", {
          targetType: "client",
          targetId: id,
          summary: `Redefiniu a senha de ${client.name} para o CNPJ`,
        });
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    }
  );

  app.put(
    "/api/accountant/client/:id",
    verifyAccountantAuth,
    validateBody(accountantUpdateClientSchema),
    async (req, res) => {
      const { name, regularityStatus, integrationHash, accountantCategory } =
        req.body;
      try {
        const patch: Record<string, unknown> = {
          name,
          regularityStatus,
          accountantCategory: accountantCategory || null,
        };
        // The integration token is only ever touched here when the accountant
        // explicitly pasted one — it's stored hashed (see setIntegrationToken).
        // Managed independently by generate-token / revoke-token.
        if (typeof integrationHash === "string" && integrationHash.trim()) {
          Object.assign(patch, setIntegrationToken(integrationHash.trim()));
        }
        const [updated] = await db
          .update(clients)
          .set(patch)
          .where(eq(clients.id, req.params.id))
          .returning();
        await logAudit(req, "client.update", {
          targetType: "client",
          targetId: req.params.id,
          summary: `Atualizou o cliente ${updated?.name ?? req.params.id}`,
          metadata: { regularityStatus, accountantCategory },
        });
        res.json({ success: true, client: updated ? clientAdminDTO(updated) : null });
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
        const [victim] = await db.select().from(clients).where(eq(clients.id, clientId));
        // Delete dependencies
        await db.delete(guiasGeradas).where(eq(guiasGeradas.clientId, clientId));
        await db.delete(scheduledNotifications).where(eq(scheduledNotifications.clientId, clientId));
        await db.delete(subscriptions).where(eq(subscriptions.clientId, clientId));
        await db.delete(documents).where(eq(documents.clientId, clientId));
        await db.delete(billingData).where(eq(billingData.clientId, clientId));
        await db.delete(messages).where(eq(messages.clientId, clientId));

        // Delete client
        await db.delete(clients).where(eq(clients.id, clientId));
        await logAudit(req, "client.delete", {
          targetType: "client",
          targetId: clientId,
          summary: `Excluiu o cliente ${victim?.name ?? clientId} e todos os seus dados`,
        });
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
        client: clientAdminDTO(client),
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
        const sizes = await Promise.all(allDocs.map((doc) => fileSizeFor(doc.fileUrl)));
        res.json({ totalSize: sizes.reduce((a, b) => a + b, 0) });
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

      const filesWithMetadata = await Promise.all(
        allDocs.map(async (doc) => {
          const cl = allClients.find((c) => c.id === doc.clientId);
          return {
            id: doc.id,
            title: doc.title,
            category: doc.category,
            status: doc.status,
            createdAt: doc.createdAt.toISOString(),
            fileUrl: doc.fileUrl,
            size: await fileSizeFor(doc.fileUrl),
            clientName: cl?.name || "Desconhecido",
            clientId: doc.clientId,
            uploadedBy: doc.uploadedBy,
          };
        }),
      );

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

        await Promise.all(
          docsToDelete.map(async (doc) => {
            const abs = resolveUploadPath(doc.fileUrl);
            if (abs) await fs.promises.unlink(abs).catch(() => {});
          }),
        );

        await db.delete(documents).where(inArray(documents.id, fileIds));
        await logAudit(req, "files.bulk_delete", {
          targetType: "document",
          summary: `Excluiu ${docsToDelete.length} arquivo(s)`,
          metadata: { fileIds },
        });
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
    validateUploadedFileContent,
    validateBody(accountantUploadDocSchema),
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
        
      // Trigger debounced notification
      triggerDebouncedDocumentNotification(newDoc);

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
    validateUploadedFileContent,
    validateBody(accountantUpdateDocSchema),
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
    validateBody(accountantMessageSchema),
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
    validateBody(accountantBulkMessageSchema),
    async (req, res) => {
      const { clientIds, content } = req.body;

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
    validateBody(docStatusSchema),
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
    validateBody(accountantEditMessageSchema),
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

      const newToken = generateIntegrationToken();
      await db
        .update(clients)
        .set(setIntegrationToken(newToken))
        .where(eq(clients.id, clientId));

      await logAudit(req, "token.generate", {
        targetType: "client",
        targetId: clientId,
        summary: `Gerou um token de integração para ${clientList[0].name}`,
      });
      // Only time the plaintext token is ever returned.
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
        .set(clearIntegrationToken())
        .where(eq(clients.id, clientId));

      await logAudit(req, "token.revoke", {
        targetType: "client",
        targetId: clientId,
        summary: `Revogou o token de integração de ${clientList[0].name}`,
      });
      res.json({ success: true });
    },
  );


  app.post(
    "/api/accountant/client/:id/update-billing",
    verifyAccountantAuth,
    validateBody(billingUpdateSchema),
    async (req, res) => {
      try {
        await upsertBilling(req.params.id, req.body);
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
    validateBody(billingBulkSchema),
    async (req, res) => {
      try {
        for (const item of req.body.data) {
          await upsertBilling(req.params.id, item);
        }
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    },
  );


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
        
        // Never return any credential to the browser — only whether each is set.
        const sanitizedConfig = {
          id: config[0].id,
          usuarioId: config[0].usuarioId,
          cnpjContratante: config[0].cnpjContratante,
          ambiente: config[0].ambiente,
          whatsappSupport: config[0].whatsappSupport,
          multipleFilesText: config[0].multipleFilesText,
          updatedAt: config[0].updatedAt,
          hasKey: !!config[0].consumerKey,
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
    validateBody(serproConfigSchema),
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

        const updateData: Record<string, unknown> = {
          cnpjContratante,
          ambiente,
          whatsappSupport,
          multipleFilesText,
        };
        // Credentials are write-only: only touched when a non-empty value is
        // sent ("leave blank to keep"). Secrets are stored encrypted at rest.
        if (typeof consumerKey === "string" && consumerKey.trim()) {
          updateData.consumerKey = consumerKey.trim();
        }
        if (typeof consumerSecret === "string" && consumerSecret.trim()) {
          updateData.consumerSecret = encryptSecret(consumerSecret.trim());
        }
        if (typeof certSenha === "string" && certSenha.trim()) {
          updateData.certSenha = encryptSecret(certSenha.trim());
        }

        let config = await db
          .select()
          .from(serproConfig)
          .where(eq(serproConfig.usuarioId, 1))
          .limit(1);

        if (req.file) {
          // multer wrote the raw .pfx to disk — replace it with an encrypted
          // copy at the same path.
          try {
            const raw = await fs.promises.readFile(req.file.path);
            await fs.promises.writeFile(req.file.path, encryptBytes(raw));
          } catch (err) {
            console.error("Falha ao cifrar o certificado:", err);
          }
          updateData.certPath = req.file.path;
        }

        // Se houver certificado anterior no banco e um novo arquivo foi enviado, exclui o anterior
        if (config.length > 0 && config[0].certPath && req.file && config[0].certPath !== req.file.path) {
          try {
            await fs.promises.unlink(config[0].certPath);
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
        res.status(500).json({ error: "Falha ao salvar a configuração do Integra Contador." });
      }
    },
  );
}
