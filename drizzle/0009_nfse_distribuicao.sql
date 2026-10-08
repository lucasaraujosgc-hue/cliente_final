-- NFS-e: distribuição de DF-e (ADN Contribuinte). O sistema busca no portal
-- nacional as NFS-e do prestador que NÃO foram emitidas por aqui (emitidas pela
-- prefeitura ou por outro sistema) e as reflete em nfse_emissoes.
-- Aditiva e idempotente.

ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "origem" text DEFAULT 'sistema' NOT NULL;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "nsu" bigint;--> statement-breakpoint
ALTER TABLE "nfse_config" ADD COLUMN IF NOT EXISTS "ultimo_nsu" bigint DEFAULT 0 NOT NULL;
