require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT id, subscription_object->>'endpoint' as endpoint FROM subscriptions LIMIT 1");
    console.log(res.rows);
  } finally {
    client.release();
    pool.end();
  }
}
run();
