import { Express } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
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
} from "../schema";
import { upload, uploadCert } from "../services/upload";
import { triggerDebouncedDocumentNotification } from "../services/notificationSweeper";
import { verifyAccountantAuth } from "../middleware/auth";

// Routes used by the accountant-facing admin panel: client CRUD, file
// management, inbox/messages, billing, and SERPRO integration settings.
export function registerAccountantRoutes(app: Express) {
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
}
