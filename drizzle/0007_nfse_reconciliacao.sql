-- NFS-e: reconciliação da resposta do Sefin Nacional + idempotência da emissão.
-- Aditiva e idempotente (mesmo estilo do 0006).

ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "alertas" jsonb;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "versao_aplicativo" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "sefin_processado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "sync_tentativas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nfse_emissoes_client_id_dps_uq" ON "nfse_emissoes" ("client_id","id_dps");
