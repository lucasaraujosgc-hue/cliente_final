/**
 * Applies pending Drizzle migrations from ./drizzle.
 *
 * Workflow going forward:
 *   1. edit src/server/schema.ts
 *   2. npm run db:generate      (writes a new drizzle/NNNN_*.sql)
 *   3. commit it
 *   4. npm run db:migrate       (locally / in the deploy pipeline)
 *
 * Baseline adoption: migration 0000_baseline describes the schema that the
 * legacy initDb() already builds with CREATE TABLE IF NOT EXISTS. For any
 * database that predates migrations we mark 0000 as already applied so the
 * migrator only runs 0001+ (running 0000's bare CREATE TABLEs against a
 * populated DB would fail). A brand-new empty DB gets 0000 applied normally.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pool, db } from "../src/server/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

async function adoptBaselineIfNeeded() {
  const journalPath = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) return;

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const baseline = journal.entries?.[0];
  if (!baseline) return;

  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM "drizzle"."__drizzle_migrations"`,
  );
  if (rows[0].n > 0) return; // migrations already tracked, nothing to adopt

  // Does the DB already contain the baseline schema (i.e. this is a pre-existing
  // deployment)? If "clients" exists, treat 0000 as done.
  const { rows: t } = await pool.query(`SELECT to_regclass('public.clients') AS c`);
  if (!t[0].c) return; // fresh DB — let migrate() run 0000 normally

  const sql = fs.readFileSync(
    path.join(MIGRATIONS_FOLDER, `${baseline.tag}.sql`),
    "utf8",
  );
  const hash = crypto.createHash("sha256").update(sql).digest("hex");
  await pool.query(
    `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
    [hash, baseline.when],
  );
  console.log("[migrate] adopted existing schema as baseline 0000");
}

async function main() {
  await adoptBaselineIfNeeded();
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("[migrate] up to date");
  await pool.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
