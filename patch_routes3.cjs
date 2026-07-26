const fs = require('fs');
const path = 'src/server/routes.ts';
let code = fs.readFileSync(path, 'utf8');

const importTarget = `import { eq, desc, asc, inArray, or } from "drizzle-orm";`;
const importReplacement = `import { eq, desc, asc, inArray, or, sql } from "drizzle-orm";`;
if (code.includes(importTarget)) {
  code = code.replace(importTarget, importReplacement);
}

const target = `        if (fcmToken) {
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
        }`;

const replacement = `        if (fcmToken) {
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
            .where(sql\`subscription_object->>'endpoint' = \${subscriptionObject.endpoint}\`);
            
          if (existing.length > 0) {
            await db
              .update(subscriptions)
              .set({ clientId, deviceName: deviceName || "Dispositivo" })
              .where(eq(subscriptions.id, existing[0].id));
            return res.status(200).json({ success: true, updated: true });
          }
        }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(path, code, 'utf8');
  console.log('Successfully patched routes.ts');
} else {
  console.log('Target not found in routes.ts');
}
