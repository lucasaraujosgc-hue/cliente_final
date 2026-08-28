/**
 * The one and only way the Postgres schema evolves.
 *
 *   1. edit src/server/schema.ts
 *   2. npm run db:generate      -> writes drizzle/NNNN_*.sql
 *   3. commit it
 *   4. npm run db:migrate       -> applies pending migrations
 *
 * The server never touches the schema at boot. Deploy runs this first
 * (package.json "prestart" -> node dist/migrate.cjs).
 *
 * Legacy bridge: databases created by the old src/server/db.ts
 * CREATE/ALTER-on-boot path have the tables but no migration history. The
 * first run here detects that, applies drizzle/reconcile-legacy.sql (fully
 * idempotent, additive — see the file header) to bring them exactly to
 * drizzle/0000_baseline.sql, marks the baseline as applied, and from then on
 * everything is plain Drizzle migrations.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pool, db } from "../src/server/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

async function tableExists(schema: string, name: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    [`${schema}.${name}`],
  );
  return rows[0]?.present === true;
}

async function ensureMigrationsTable() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function migrationsRecorded(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
  );
  return rows[0].n as number;
}

function baselineEntry() {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
  );
  const entry = journal.entries?.[0];
  if (!entry || entry.idx !== 0) {
    throw new Error("drizzle/meta/_journal.json: expected a baseline entry at idx 0");
  }
  const sql = fs.readFileSync(
    path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
    "utf8",
  );
  return { when: entry.when as number, hash: crypto.createHash("sha256").update(sql).digest("hex") };
}

async function reconcileLegacyDatabase() {
  const sql = fs.readFileSync(
    path.join(MIGRATIONS_FOLDER, "reconcile-legacy.sql"),
    "utf8",
  );
  const baseline = baselineEntry();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`,
      [baseline.hash, baseline.when],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  console.log("[migrate] legacy database reconciled to baseline 0000");
}

const EXPECTED_TABLES = [
  "clients",
  "documents",
  "billing_data",
  "messages",
  "subscriptions",
  "serpro_config",
  "guias_geradas",
  "scheduled_notifications",
  "audit_log",
  "auth_sessions",
];

// Sanity check after migrating: every table exists, the password-reset
// hardening columns landed, and the client_id FKs cascade. Missing table =>
// hard fail; softer mismatches => warning.
async function verifySchema() {
  const { rows: tableRows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [EXPECTED_TABLES],
  );
  const present = new Set(tableRows.map((r) => r.table_name));
  const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
  if (missing.length) {
    throw new Error(`schema verification failed — missing tables: ${missing.join(", ")}`);
  }

  const { rows: colRows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='clients'
        AND column_name IN ('reset_code_hash','reset_code_expires','reset_code_attempts','reset_token','reset_token_expires')`,
  );
  const cols = new Map(colRows.map((r) => [r.column_name, r.data_type]));
  for (const c of ["reset_code_hash", "reset_code_expires", "reset_code_attempts"]) {
    if (!cols.has(c)) console.warn(`[migrate] WARN: clients.${c} is missing`);
  }
  if (cols.has("reset_token") || cols.has("reset_token_expires")) {
    console.warn("[migrate] WARN: legacy clients.reset_token* column still present");
  }

  const { rows: fkRows } = await pool.query(
    `SELECT rel.relname AS child, c.confdeltype
       FROM pg_constraint c
       JOIN pg_class rel ON rel.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname='public' AND c.contype='f'
        AND rel.relname = ANY($1)`,
    [["documents", "billing_data", "messages", "subscriptions", "guias_geradas", "scheduled_notifications"]],
  );
  for (const r of fkRows) {
    if (r.confdeltype !== "c") {
      console.warn(`[migrate] WARN: ${r.child}.client_id FK is not ON DELETE CASCADE (confdeltype=${r.confdeltype})`);
    }
  }

  console.log(`[migrate] schema verified — ${EXPECTED_TABLES.length} tables present`);
}

async function main() {
  await ensureMigrationsTable();

  if ((await migrationsRecorded()) === 0 && (await tableExists("public", "clients"))) {
    await reconcileLegacyDatabase();
  }

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await verifySchema();
  console.log("[migrate] schema up to date");
  await pool.end();
}

main().catch((err) => {
  console.error("[migrate] FAILED:", err);
  process.exit(1);
});
