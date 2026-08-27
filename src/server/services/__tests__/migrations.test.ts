import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";

const DRIZZLE = path.join(process.cwd(), "drizzle");
const baselineSql = fs.readFileSync(path.join(DRIZZLE, "0000_baseline.sql"), "utf8");
const reconcileSql = fs.readFileSync(path.join(DRIZZLE, "reconcile-legacy.sql"), "utf8");

const EXPECTED_TABLES = [
  "clients", "documents", "billing_data", "messages", "subscriptions",
  "serpro_config", "guias_geradas", "scheduled_notifications", "audit_log",
];

async function tables(db: PGlite): Promise<Set<string>> {
  const r = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`,
  );
  return new Set(r.rows.map((x) => x.table_name));
}

async function columnType(db: PGlite, table: string, col: string): Promise<string | null> {
  const r = await db.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, col],
  );
  return r.rows[0]?.data_type ?? null;
}

async function fkDeleteRule(db: PGlite, child: string): Promise<string | null> {
  const r = await db.query<{ confdeltype: string }>(
    `SELECT c.confdeltype
       FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid
      WHERE rel.relname=$1 AND c.contype='f'`,
    [child],
  );
  return r.rows[0]?.confdeltype ?? null; // 'c' = cascade
}

async function constraintExists(db: PGlite, name: string): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM pg_constraint WHERE conname=$1`, [name]);
  return r.rows.length > 0;
}

/** Assertions the schema must satisfy however it was built. */
async function assertTargetSchema(db: PGlite) {
  expect([...(await tables(db))].sort()).toEqual(expect.arrayContaining(EXPECTED_TABLES));

  expect(await columnType(db, "clients", "reset_code_hash")).toBe("text");
  expect(await columnType(db, "clients", "reset_code_expires")).toMatch(/timestamp/);
  expect(await columnType(db, "clients", "reset_code_attempts")).toBe("integer");
  expect(await columnType(db, "clients", "reset_token")).toBeNull();
  expect(await columnType(db, "clients", "reset_token_expires")).toBeNull();

  expect(await columnType(db, "documents", "extracted_data")).toBe("jsonb");
  expect(await columnType(db, "subscriptions", "subscription_object")).toBe("jsonb");
  expect(await columnType(db, "billing_data", "services_revenue")).toBe("integer");
  expect(await columnType(db, "documents", "competence")).toBe("text");
  expect(await columnType(db, "messages", "direction")).toBe("text");
  expect(await columnType(db, "serpro_config", "whatsapp_support")).toBe("text");

  for (const child of ["documents", "billing_data", "messages", "subscriptions", "guias_geradas", "scheduled_notifications"]) {
    expect(await fkDeleteRule(db, child)).toBe("c"); // ON DELETE CASCADE
  }

  expect(await constraintExists(db, "clients_cnpj_unique")).toBe(true);
  expect(await constraintExists(db, "clients_integration_hash_unique")).toBe(true);
}

// Approximates a database built by the pre-migrations src/server/db.ts:
// early CREATE shape + only some of the later ALTERs, postgres-named FKs
// without CASCADE, json (not jsonb), the old reset_token pair, no audit_log.
const LEGACY_SCHEMA = `
CREATE TABLE "clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cnpj" text NOT NULL,
  "name" text NOT NULL,
  "password_hash" text NOT NULL,
  "regularity_status" text NOT NULL,
  "email" text,
  "first_access_done" boolean DEFAULT false,
  "integration_hash" text,
  "reset_token" text,
  "reset_token_expires" text,
  CONSTRAINT "clients_cnpj_key" UNIQUE ("cnpj"),
  CONSTRAINT "clients_integration_hash_key" UNIQUE ("integration_hash")
);
CREATE TABLE "documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" uuid NOT NULL REFERENCES "clients"("id"),
  "title" text NOT NULL,
  "category" text NOT NULL,
  "due_date" text,
  "status" text NOT NULL,
  "uploaded_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "file_url" text,
  "extracted_data" json
);
CREATE TABLE "billing_data" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" uuid NOT NULL REFERENCES "clients"("id"),
  "month" text NOT NULL,
  "revenue" integer NOT NULL,
  "expenses" integer NOT NULL,
  "payroll" integer NOT NULL
);
CREATE TABLE "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" uuid NOT NULL REFERENCES "clients"("id"),
  "content" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "read" boolean DEFAULT false NOT NULL
);
CREATE TABLE "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" uuid NOT NULL REFERENCES "clients"("id"),
  "subscription_object" json,
  "device_name" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "serpro_config" (
  "id" serial PRIMARY KEY,
  "usuario_id" integer NOT NULL DEFAULT 1,
  "consumer_key" text,
  "consumer_secret" text,
  "cert_path" text,
  "cert_senha" text,
  "cnpj_contratante" text,
  "ambiente" text DEFAULT 'trial',
  "updated_at" timestamp DEFAULT now()
);
CREATE TABLE "guias_geradas" (
  "id" serial PRIMARY KEY,
  "client_id" uuid NOT NULL REFERENCES "clients"("id"),
  "usuario_id" integer NOT NULL DEFAULT 1,
  "tipo_guia" text NOT NULL,
  "competencia" text NOT NULL,
  "status" text DEFAULT 'PENDENTE',
  "pdf_path" text,
  "data_vencimento" text,
  "valor_total" real,
  "numero_documento" text,
  "erro_msg" text,
  "created_at" timestamp DEFAULT now(),
  "concluido_at" timestamp
);
CREATE TABLE "scheduled_notifications" (
  "id" serial PRIMARY KEY,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "schedule_day" integer,
  "last_sent" timestamp,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
`;

// pglite (WASM Postgres) has a slow cold start.
const T = 30_000;

describe("drizzle/0000_baseline.sql (fresh database)", () => {
  it("produces the target schema", async () => {
    const db = new PGlite();
    await db.exec(baselineSql);
    await assertTargetSchema(db);
    await db.close();
  }, T);
});

describe("drizzle/reconcile-legacy.sql (database built by the old initDb)", () => {
  it("brings a legacy schema exactly to the baseline, without losing data", async () => {
    const db = new PGlite();
    await db.exec(LEGACY_SCHEMA);

    // existing data, including an in-flight plaintext reset token
    await db.exec(`
      INSERT INTO clients (id, cnpj, name, password_hash, regularity_status, reset_token, reset_token_expires)
      VALUES ('11111111-1111-1111-1111-111111111111', '12.345.678/0001-99', 'ACME', 'hash', 'green', '482913', '2026-01-01T00:00:00.000Z');
      INSERT INTO documents (client_id, title, category, status, uploaded_by, extracted_data)
      VALUES ('11111111-1111-1111-1111-111111111111', 'Guia', 'taxes', 'new', 'accountant', '{"v":1}');
    `);

    await db.exec(reconcileSql);
    await assertTargetSchema(db);

    // data preserved
    const c = await db.query<{ cnpj: string; reset_code_hash: string | null; reset_code_attempts: number }>(
      `SELECT cnpj, reset_code_hash, reset_code_attempts FROM clients`,
    );
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].cnpj).toBe("12.345.678/0001-99");
    // legacy plaintext token (6 chars) was cleared, not carried over as a "hash"
    expect(c.rows[0].reset_code_hash).toBeNull();
    expect(c.rows[0].reset_code_attempts).toBe(0);

    const d = await db.query(`SELECT extracted_data FROM documents`);
    expect(d.rows).toHaveLength(1);
    expect((d.rows[0] as any).extracted_data).toEqual({ v: 1 });

    await db.close();
  }, T);

  it("is idempotent (safe to run twice)", async () => {
    const db = new PGlite();
    await db.exec(LEGACY_SCHEMA);
    await db.exec(reconcileSql);
    await db.exec(reconcileSql); // must not throw
    await assertTargetSchema(db);
    await db.close();
  }, T);

  it("ON DELETE CASCADE actually removes children after reconcile", async () => {
    const db = new PGlite();
    await db.exec(LEGACY_SCHEMA);
    await db.exec(`
      INSERT INTO clients (id, cnpj, name, password_hash, regularity_status)
      VALUES ('22222222-2222-2222-2222-222222222222', '00.000.000/0001-00', 'X', 'h', 'green');
      INSERT INTO documents (client_id, title, category, status, uploaded_by)
      VALUES ('22222222-2222-2222-2222-222222222222', 'D', 'taxes', 'new', 'accountant');
    `);
    await db.exec(reconcileSql);
    await db.query(`DELETE FROM clients WHERE id='22222222-2222-2222-2222-222222222222'`);
    const left = await db.query(`SELECT count(*)::int AS n FROM documents`);
    expect((left.rows[0] as any).n).toBe(0);
    await db.close();
  })
});
