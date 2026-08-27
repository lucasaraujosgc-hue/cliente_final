import { Express } from "express";
import { eq, desc, inArray, sql } from "drizzle-orm";
import { getApps } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { db } from "../db";
import { clients, subscriptions, scheduledNotifications } from "../schema";
import { vapidKeys, webpush } from "../services/push";
import { verifyClientAuth, verifyAccountantAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { scheduledNotificationSchema } from "../schemas/validation";

// Web-push / FCM subscription management and scheduled-notification rules.
export function registerNotificationRoutes(app: Express) {
  app.get("/api/vapidPublicKey", (req, res) => {
    res.send(vapidKeys.publicKey);
  });

  app.post(
    "/api/notifications/subscribe",
    verifyClientAuth,
    async (req, res) => {
      try {
        const clientId = (req as any).user.clientId;
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
