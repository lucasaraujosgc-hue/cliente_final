import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

// The server does NOT create or alter the schema. That is done, explicitly,
// by `npm run db:migrate` (scripts/migrate.ts) before the app starts — see
// MIGRATIONS.md. This only checks the connection so a bad DATABASE_URL fails
// fast at boot with a clear message instead of on the first request.
export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    // Cheap sanity check that migrations have run.
    const { rows } = await client.query(
      `SELECT to_regclass('public.clients') IS NOT NULL AS ready`,
    );
    if (!rows[0]?.ready) {
      console.warn(
        '[db] "clients" table not found — run `npm run db:migrate` before starting the server.',
      );
    }
  } finally {
    client.release();
  }
}
