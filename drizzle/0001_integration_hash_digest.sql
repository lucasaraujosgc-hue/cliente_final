-- Integration tokens move from plaintext (clients.integration_hash) to a
-- sha256 digest (clients.integration_hash_digest). The plaintext column stays
-- for a transition window so existing webhook integrations keep working
-- (findClientByIntegrationToken matches either). A later migration drops it.
-- No data is destroyed here.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "integration_hash_digest" text;--> statement-breakpoint
UPDATE "clients"
   SET "integration_hash_digest" = encode(sha256(convert_to("integration_hash", 'UTF8')), 'hex')
 WHERE "integration_hash" IS NOT NULL
   AND "integration_hash_digest" IS NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_integration_hash_digest_unique') THEN
    ALTER TABLE "clients" ADD CONSTRAINT "clients_integration_hash_digest_unique" UNIQUE ("integration_hash_digest");
  END IF;
END $$;
