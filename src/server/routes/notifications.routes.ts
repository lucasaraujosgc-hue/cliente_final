import { Express } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { clients, subscriptions, scheduledNotifications } from "../schema";
import { vapidKeys, enviarParaClientes, pushStatus, testarDispositivo } from "../services/push";
import { logAudit } from "../services/audit";
import { verifyClientAuth, verifyAccountantAuth } from "../middleware/auth";
import { getClientId } from "../types";
import { validateBody } from "../middleware/validate";
import {
  scheduledNotificationSchema,
  notificationSubscribeSchema,
  adminNotificationSendSchema,
  pushTesteSchema,
} from "../schemas/validation";

// Web-push / FCM subscription management and scheduled-notification rules.
export function registerNotificationRoutes(app: Express) {
  app.get("/api/vapidPublicKey", (req, res) => {
    res.send(vapidKeys.publicKey);
  });

  app.post(
    "/api/notifications/subscribe",
    verifyClientAuth,
    validateBody(notificationSubscribeSchema),
    async (req, res) => {
      try {
        const clientId = getClientId(req);
        const { subscriptionObject, fcmToken, deviceName } = req.body;

        if (fcmToken) {
          const existing = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.fcmToken, fcmToken));

          if (existing.length > 0) {
            await db
              .update(subscriptions)
              .set({ clientId, deviceName: deviceName || "Dispositivo" })
              .where(eq(subscriptions.fcmToken, fcmToken));
            return res.status(200).json({ success: true, updated: true });
          }
        } else if (subscriptionObject && subscriptionObject.endpoint) {
          const existing = await db
            .select()
            .from(subscriptions)
            .where(sql`subscription_object->>'endpoint' = ${subscriptionObject.endpoint}`);
            
          if (existing.length > 0) {
            await db
              .update(subscriptions)
              .set({ clientId, deviceName: deviceName || "Dispositivo" })
              .where(eq(subscriptions.id, existing[0].id));
            return res.status(200).json({ success: true, updated: true });
          }
        }

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
    validateBody(adminNotificationSendSchema),
    async (req, res) => {
      try {
        const { userIds, title, body } = req.body;
        // Mesmo funil dos avisos automáticos: entra no histórico do cliente
        // (visto no portal mesmo sem aparelho cadastrado) e vai por push.
        const r = await enviarParaClientes(userIds?.length ? userIds : null, title, body);
        await logAudit(req, "notification.send", {
          summary: `Aviso "${String(title).slice(0, 60)}" para ${userIds?.length ? `${userIds.length} cliente(s)` : "todos"}: ${r.entregues}/${r.resultados.length} entrega(s)`,
          metadata: { clientes: userIds?.length ?? null, dispositivos: r.dispositivos, entregues: r.entregues, falhas: r.falhas, clientesSemAparelho: r.clientesSemAparelho },
        });
        res.status(200).json({
          success: true,
          dispositivos: r.dispositivos,
          entregues: r.entregues,
          falhas: r.falhas,
          clientesSemAparelho: r.clientesSemAparelho,
          erros: [...new Set(r.resultados.filter((x) => !x.ok).map((x) => x.erro))],
        });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // Diagnóstico do push (tela Dispositivos): Firebase configurado? chaves do
  // navegador fixas? quantos aparelhos de cada tipo.
  app.get("/api/admin/notifications/status", verifyAccountantAuth, async (_req, res) => {
    const subs = await db.select({ fcm: subscriptions.fcmToken, web: subscriptions.subscriptionObject }).from(subscriptions);
    res.json({
      ...pushStatus(),
      dispositivos: { app: subs.filter((x) => x.fcm).length, navegador: subs.filter((x) => x.web).length },
    });
  });

  // Teste de um aparelho. `dryRun` = o Firebase valida credenciais e token sem
  // entregar nada (só para o app); sem ele, a notificação de teste chega mesmo.
  app.post("/api/accountant/subscriptions/:id/test", verifyAccountantAuth, validateBody(pushTesteSchema), async (req, res) => {
    const resultados = await testarDispositivo(req.params.id, { dryRun: !!req.body.dryRun });
    if (!resultados) return res.status(404).json({ error: "Aparelho não encontrado." });
    if (!req.body.dryRun) {
      await logAudit(req, "notification.test", {
        targetType: "subscription",
        targetId: req.params.id,
        summary: `Notificação de teste: ${resultados.map((r) => `${r.canal} ${r.ok ? "ok" : r.erro}`).join(", ") || "aparelho sem canal"}`,
      });
    }
    res.json({ resultados });
  });

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
    validateBody(scheduledNotificationSchema),
    async (req, res) => {
      try {
        const { clientId, type, title, body, scheduleDay, scheduleTime } = req.body;

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


  app.get("/api/accountant/subscriptions", verifyAccountantAuth, async (req, res) => {
    try {
      const allClients = await db.select().from(clients);
      const subs = await db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt));
      
      const enrichedSubs = subs.map(sub => {
        const client = allClients.find(c => c.id === sub.clientId);
        return {
          ...sub,
          client: client ? { id: client.id, name: client.name, cnpj: client.cnpj } : null
        };
      });

      res.json({ subscriptions: enrichedSubs });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });



  app.delete("/api/accountant/subscriptions/:id", verifyAccountantAuth, async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(subscriptions).where(eq(subscriptions.id, id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

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
