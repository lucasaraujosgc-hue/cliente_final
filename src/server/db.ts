import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

export async function initDb() {
  const client = await pool.connect();
  try {
    // Basic automatic table creation for quick testing if they don't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS "clients" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "cnpj" text NOT NULL UNIQUE,
        "name" text NOT NULL,
        "password_hash" text NOT NULL,
        "regularity_status" text NOT NULL,
        "email" text,
        "first_access_done" boolean DEFAULT false,
        "integration_hash" text UNIQUE
      );

      CREATE TABLE IF NOT EXISTS "documents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
        "title" text NOT NULL,
        "category" text NOT NULL,
        "due_date" text,
        "status" text NOT NULL,
        "uploaded_by" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "file_url" text
      );

      CREATE TABLE IF NOT EXISTS "billing_data" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
        "month" text NOT NULL,
        "revenue" integer NOT NULL,
        "expenses" integer NOT NULL,
        "payroll" integer NOT NULL
      );

      CREATE TABLE IF NOT EXISTS "messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
        "content" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "read" boolean DEFAULT false NOT NULL
      );
    `);

    // Schema updates
    await client.query(`ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "accountant_category" text;`);
    await client.query(`ALTER TABLE "billing_data" ADD COLUMN IF NOT EXISTS "services_revenue" integer DEFAULT 0 NOT NULL;`);
    await client.query(`ALTER TABLE "billing_data" ADD COLUMN IF NOT EXISTS "sales_revenue" integer DEFAULT 0 NOT NULL;`);
    await client.query(`ALTER TABLE "billing_data" ADD COLUMN IF NOT EXISTS "total_incomes" integer DEFAULT 0 NOT NULL;`);
    await client.query(`ALTER TABLE "billing_data" ADD COLUMN IF NOT EXISTS "services_taken" integer DEFAULT 0 NOT NULL;`);
    await client.query(`ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "competence" text;`);
    await client.query(`ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "pix_code" text;`);
    await client.query(`ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "extracted_data" jsonb;`);
    await client.query(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "direction" text DEFAULT 'accountant_to_client' NOT NULL;`);
    await client.query(`ALTER TABLE "scheduled_notifications" ADD COLUMN IF NOT EXISTS "schedule_time" text;`);
    await client.query(`ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "notification_preferences" json DEFAULT '{"receives_all":true,"recurrent":true,"before_due":true,"on_due":true,"on_new_file":true}'::json;`);

    await client.query(`ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "reset_token" text;`);
    await client.query(`ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "reset_token_expires" text;`);
    await client.query(`ALTER TABLE "serpro_config" ADD COLUMN IF NOT EXISTS "whatsapp_support" text;`);
    await client.query(`ALTER TABLE "subscriptions" ALTER COLUMN "subscription_object" DROP NOT NULL;`);
    await client.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "fcm_token" text;`);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS "subscriptions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "client_id" uuid NOT NULL REFERENCES "clients"("id"),
        "subscription_object" jsonb,
        "fcm_token" text,
        "device_name" text,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS "serpro_config" (
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

      CREATE TABLE IF NOT EXISTS "guias_geradas" (
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

      CREATE TABLE IF NOT EXISTS "scheduled_notifications" (
        "id" serial PRIMARY KEY,
        "client_id" uuid REFERENCES "clients"("id") ON DELETE CASCADE,
        "type" text NOT NULL,
        "title" text NOT NULL,
        "body" text NOT NULL,
        "schedule_day" integer,
        "schedule_time" text,
        "last_sent" timestamp,
        "active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `);

    // Remove test companies
    await client.query(`DELETE FROM "clients" WHERE cnpj IN ('12.345.678/0001-99', '98.765.432/0001-11');`);
    
    // Check if empty, run seed
    const res = await client.query('SELECT count(*) FROM "clients"');
    if (parseInt(res.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO "clients" ("id", "cnpj", "name", "password_hash", "regularity_status", "first_access_done") VALUES
        ('c8f4b0ab-2b7e-4628-98e3-0d5b5b0eb101', '12.345.678/0001-99', 'Empresa XPTO Ltda', '12.345.678/0001-99', 'warning', false),
        ('c8f4b0ab-2b7e-4628-98e3-0d5b5b0eb102', '98.765.432/0001-11', 'Startup Inovadora S/A', '98.765.432/0001-11', 'green', false);

        INSERT INTO "documents" ("client_id", "title", "category", "due_date", "status", "uploaded_by") VALUES
        ('c8f4b0ab-2b7e-4628-98e3-0d5b5b0eb101', 'Guia DAS (Simples Nacional)', 'taxes', '2026-06-20', 'pending', 'accountant'),
        ('c8f4b0ab-2b7e-4628-98e3-0d5b5b0eb101', 'Contrato Social v2', 'company', null, 'viewed', 'accountant');

        INSERT INTO "billing_data" ("client_id", "month", "revenue", "expenses", "payroll") VALUES
        ('c8f4b0ab-2b7e-4628-98e3-0d5b5b0eb101', '2026-01', 50000, 15000, 20000),
        ('c8f4b0ab-2b7e-4628-98e3-0d5b5b0eb101', '2026-02', 55000, 14000, 20000),
        ('c8f4b0ab-2b7e-4628-98e3-0d5b5b0eb101', '2026-03', 48000, 16000, 20000),
        ('c8f4b0ab-2b7e-4628-98e3-0d5b5b0eb101', '2026-04', 60000, 15000, 22000),
        ('c8f4b0ab-2b7e-4628-98e3-0d5b5b0eb101', '2026-05', 65000, 18000, 22000);

        INSERT INTO "messages" ("client_id", "content", "read") VALUES
        ('c8f4b0ab-2b7e-4628-98e3-0d5b5b0eb101', 'Lembrete: fechamento da folha até dia 05, enviar recibos pendentes.', false);
      `);
    }
  } catch (err) {
    console.error("Failed to initialize database:", err);
  } finally {
    client.release();
  }
}

