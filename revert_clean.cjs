const fs = require('fs');
const path = 'src/server/routes.ts';
let code = fs.readFileSync(path, 'utf8');

const target = `  app.post("/api/admin/clean-subscriptions", async (req, res) => {
    try {
      const { pool } = await import('./db');
      
      // 1. Delete duplicate FCM tokens
      await pool.query(\`
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
      \`);

      // 2. Delete duplicate Web Push subscriptions
      await pool.query(\`
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
      \`);

      res.json({ success: true, message: "Cleaned duplicate subscriptions." });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });`;

if (code.includes(target)) {
  code = code.replace(target, '');
  fs.writeFileSync(path, code, 'utf8');
  console.log('Successfully reverted cleanup route.');
} else {
  console.log('Target not found.');
}
