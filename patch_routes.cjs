const fs = require('fs');
const path = 'src/server/routes.ts';
let code = fs.readFileSync(path, 'utf8');

const target = `  app.post(
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
  );`;

const replacement = `  app.post(
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
  );`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(path, code, 'utf8');
  console.log('Routes patched successfully');
} else {
  console.log('Target not found in routes.ts');
}
