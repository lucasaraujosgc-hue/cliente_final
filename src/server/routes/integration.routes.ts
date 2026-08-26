import { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { clients, documents, billingData } from "../schema";
import { verifyIntegrationToken } from "../middleware/auth";
import { hashPassword } from "../services/password";

// External-facing integration API, authenticated via each client's
// integration hash token (not JWT).
export function registerIntegrationRoutes(app: Express) {
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
            passwordHash: await hashPassword(cnpj.replace(/[^0-9]/g, "").slice(0, 6)),
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
}
