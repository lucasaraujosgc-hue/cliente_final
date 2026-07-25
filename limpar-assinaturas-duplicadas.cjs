require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  const client = await pool.connect();
  try {
    console.log("Iniciando a remoção de assinaturas duplicadas...");
    // Keep the most recent subscription for each fcm_token
    const sql = `
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
      RETURNING id, fcm_token;
    `;
    const result = await client.query(sql);
    console.log(`Limpeza concluída com sucesso!`);
    console.log(`${result.rowCount} assinaturas duplicadas foram removidas do banco de dados.`);
  } catch(e) {
    console.error("Erro durante a execução:", e);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
