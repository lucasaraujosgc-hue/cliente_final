import { db, initDb } from "./src/server/db";
import { subscriptions } from "./src/server/schema";
import { sql } from "drizzle-orm";

async function run() {
  await initDb();
  console.log("Iniciando limpeza de assinaturas...");
  try {
    // 1. Delete duplicate FCM tokens
    const fcmResult = await db.execute(sql`
      WITH duplicates AS (
        SELECT id,
               ROW_NUMBER() OVER(
                 PARTITION BY fcm_token
                 ORDER BY created_at DESC
               ) as row_num
        FROM subscriptions
        WHERE fcm_token IS NOT NULL
      )
      DELETE FROM subscriptions
      WHERE id IN (
        SELECT id FROM duplicates WHERE row_num > 1
      )
    `);
    console.log("FCM tokens limpos");

    // 2. Delete duplicate Web Push subscriptions
    const webResult = await db.execute(sql`
      WITH duplicates AS (
        SELECT id,
               ROW_NUMBER() OVER(
                 PARTITION BY subscription_object->>'endpoint'
                 ORDER BY created_at DESC
               ) as row_num
        FROM subscriptions
        WHERE subscription_object IS NOT NULL
      )
      DELETE FROM subscriptions
      WHERE id IN (
        SELECT id FROM duplicates WHERE row_num > 1
      )
    `);
    console.log("Web Push subscriptions limpos");
  } catch (e) {
    console.error("Erro:", e);
  } finally {
    process.exit(0);
  }
}
run();
