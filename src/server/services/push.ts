import { eq } from "drizzle-orm";
import webpush from "web-push";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { db } from "../db";
import { subscriptions } from "../schema";

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

export { vapidKeys, webpush };

// Sends a push (web-push + FCM) notification to every subscription of a given client.
export async function sendClientNotification(clientId: string, title: string, body: string) {
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

// Sends a push notification to all subscriptions of a client, or to everyone if clientId is null.
// Used by the background notification sweeper.
export async function sendPushToClients(clientId: string | null, title: string, body: string) {
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
