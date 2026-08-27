-- ONE-TIME legacy bridge, executed by scripts/migrate.ts only when it finds a
-- database that has the app's tables but no drizzle migration history (i.e. a
-- DB built by the old src/server/db.ts CREATE/ALTER-on-boot path).
--
-- Every statement is idempotent and additive. It brings such a database up to
-- exactly the state of drizzle/0000_baseline.sql, after which the baseline is
-- marked as applied and all further evolution goes through numbered Drizzle
-- migrations.
--
-- NOTHING here drops a table or a data column. The only destructive-looking
-- operations are:
--   * dropping + recreating the client_id foreign keys (revalidated against
--     existing rows, no data touched) to normalise their name and ON DELETE
--     rule to CASCADE;
--   * renaming clients.reset_token -> reset_code_hash and
--     reset_token_expires -> reset_code_expires (password-reset hardening).
--     In-flight reset codes are invalidated on purpose.

-- ---------------------------------------------------------------------------
-- 1. Tables (no-op when they already exist; creates audit_log on older DBs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cnpj" text NOT NULL,
  "name" text NOT NULL,
  "password_hash" text NOT NULL,
  "regularity_status" text NOT NULL,
  "email" text,
  "first_access_done" boolean DEFAULT false,
  "integration_hash" text,
  "accountant_category" text,
  "notification_preferences" json DEFAULT '{"receives_all":true,"recurrent":true,"before_due":true,"on_due":true,"on_new_file":true}'::json,
  "reset_code_hash" text,
  "reset_code_expires" timestamp,
  "reset_code_attempts" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "clients_cnpj_unique" UNIQUE("cnpj"),
  CONSTRAINT "clients_integration_hash_unique" UNIQUE("integration_hash")
);
CREATE TABLE IF NOT EXISTS "documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "title" text NOT NULL,
  "category" text NOT NULL,
  "competence" text,
  "due_date" text,
  "status" text NOT NULL,
  "uploaded_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "file_url" text,
  "pix_code" text,
  "extracted_data" jsonb
);
CREATE TABLE IF NOT EXISTS "billing_data" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "month" text NOT NULL,
  "services_revenue" integer DEFAULT 0 NOT NULL,
  "sales_revenue" integer DEFAULT 0 NOT NULL,
  "total_incomes" integer DEFAULT 0 NOT NULL,
  "services_taken" integer DEFAULT 0 NOT NULL,
  "revenue" integer DEFAULT 0 NOT NULL,
  "expenses" integer DEFAULT 0 NOT NULL,
  "payroll" integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "content" text NOT NULL,
  "direction" text DEFAULT 'accountant_to_client' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "read" boolean DEFAULT false NOT NULL
);
CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "subscription_object" jsonb,
  "fcm_token" text,
  "device_name" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "serpro_config" (
  "id" serial PRIMARY KEY NOT NULL,
  "usuario_id" integer DEFAULT 1 NOT NULL,
  "consumer_key" text,
  "consumer_secret" text,
  "cert_path" text,
  "cert_senha" text,
  "cnpj_contratante" text,
  "ambiente" text DEFAULT 'trial',
  "whatsapp_support" text,
  "multiple_files_text" text,
  "updated_at" timestamp DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "guias_geradas" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" uuid NOT NULL,
  "usuario_id" integer DEFAULT 1 NOT NULL,
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
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" uuid,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "schedule_day" integer,
  "schedule_time" text,
  "last_sent" timestamp,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "actor" text NOT NULL,
  "action" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "summary" text,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------------------
-- 2. Password-reset columns: rename the legacy pair, then ensure all three.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='clients' AND column_name='reset_token')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='clients' AND column_name='reset_code_hash') THEN
    ALTER TABLE "clients" RENAME COLUMN "reset_token" TO "reset_code_hash";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='clients' AND column_name='reset_token_expires')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='clients' AND column_name='reset_code_expires') THEN
    ALTER TABLE "clients" RENAME COLUMN "reset_token_expires" TO "reset_code_expires";
  END IF;
END $$;

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "reset_code_hash" text;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "reset_code_expires" timestamp;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "reset_code_attempts" integer DEFAULT 0 NOT NULL;

-- reset_code_expires used to be a text ISO string on legacy DBs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='clients'
               AND column_name='reset_code_expires' AND data_type='text') THEN
    ALTER TABLE "clients"
      ALTER COLUMN "reset_code_expires" TYPE timestamp
      USING NULLIF("reset_code_expires", '')::timestamp;
  END IF;
END $$;

-- Any legacy plaintext reset token is meaningless as a hash now — clear it.
UPDATE "clients"
   SET "reset_code_hash" = NULL, "reset_code_expires" = NULL, "reset_code_attempts" = 0
 WHERE "reset_code_hash" IS NOT NULL AND length("reset_code_hash") < 40;

-- ---------------------------------------------------------------------------
-- 3. Additive columns other tables gained over time (ALTER ... ADD COLUMN)
-- ---------------------------------------------------------------------------
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "accountant_category" text;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "notification_preferences" json DEFAULT '{"receives_all":true,"recurrent":true,"before_due":true,"on_due":true,"on_new_file":true}'::json;

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "competence" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "pix_code" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "extracted_data" jsonb;

ALTER TABLE "billing_data" ADD COLUMN IF NOT EXISTS "services_revenue" integer DEFAULT 0 NOT NULL;
ALTER TABLE "billing_data" ADD COLUMN IF NOT EXISTS "sales_revenue" integer DEFAULT 0 NOT NULL;
ALTER TABLE "billing_data" ADD COLUMN IF NOT EXISTS "total_incomes" integer DEFAULT 0 NOT NULL;
ALTER TABLE "billing_data" ADD COLUMN IF NOT EXISTS "services_taken" integer DEFAULT 0 NOT NULL;
ALTER TABLE "billing_data" ALTER COLUMN "revenue" SET DEFAULT 0;
ALTER TABLE "billing_data" ALTER COLUMN "expenses" SET DEFAULT 0;
ALTER TABLE "billing_data" ALTER COLUMN "payroll" SET DEFAULT 0;

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "direction" text DEFAULT 'accountant_to_client' NOT NULL;

ALTER TABLE "scheduled_notifications" ADD COLUMN IF NOT EXISTS "schedule_time" text;

ALTER TABLE "serpro_config" ADD COLUMN IF NOT EXISTS "whatsapp_support" text;
ALTER TABLE "serpro_config" ADD COLUMN IF NOT EXISTS "multiple_files_text" text;

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "fcm_token" text;
ALTER TABLE "subscriptions" ALTER COLUMN "subscription_object" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. json -> jsonb where the baseline expects jsonb
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='documents'
               AND column_name='extracted_data' AND data_type='json') THEN
    ALTER TABLE "documents" ALTER COLUMN "extracted_data" TYPE jsonb USING "extracted_data"::jsonb;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='subscriptions'
               AND column_name='subscription_object' AND data_type='json') THEN
    ALTER TABLE "subscriptions" ALTER COLUMN "subscription_object" TYPE jsonb USING "subscription_object"::jsonb;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Normalise the client_id foreign keys: drizzle-standard name + CASCADE.
--    Drop + recreate is safe (existing rows are revalidated, data untouched).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  child text;
  con   record;
BEGIN
  FOREACH child IN ARRAY ARRAY[
    'documents','billing_data','messages','subscriptions','guias_geradas','scheduled_notifications'
  ]
  LOOP
    FOR con IN
      SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
       WHERE n.nspname = 'public' AND rel.relname = child AND c.contype = 'f'
         AND (SELECT array_agg(a.attname::text ORDER BY a.attnum)
                FROM pg_attribute a
               WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)) = ARRAY['client_id']::text[]
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', child, con.conname);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE',
      child, child || '_client_id_clients_id_fk'
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Unique constraints on clients (older DBs used column-level UNIQUE with a
--    postgres-generated name; normalise to the drizzle names).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname, a.attname::text AS attname
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE n.nspname='public' AND rel.relname='clients' AND c.contype='u'
       AND array_length(c.conkey,1) = 1
       AND a.attname::text IN ('cnpj','integration_hash')
  LOOP
    IF con.attname = 'cnpj' AND con.conname <> 'clients_cnpj_unique'
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clients_cnpj_unique') THEN
      EXECUTE format('ALTER TABLE public.clients RENAME CONSTRAINT %I TO clients_cnpj_unique', con.conname);
    ELSIF con.attname = 'integration_hash' AND con.conname <> 'clients_integration_hash_unique'
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clients_integration_hash_unique') THEN
      EXECUTE format('ALTER TABLE public.clients RENAME CONSTRAINT %I TO clients_integration_hash_unique', con.conname);
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clients_cnpj_unique') THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_cnpj_unique UNIQUE (cnpj);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clients_integration_hash_unique') THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_integration_hash_unique UNIQUE (integration_hash);
  END IF;
END $$;
