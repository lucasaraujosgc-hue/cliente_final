-- NFS-e: papel do cliente em cada nota. A distribuição de DF-e (ADN) traz tanto
-- notas em que o cliente é o PRESTADOR quanto notas em que ele é o TOMADOR.
-- 'papel' separa as duas coisas para a aba "Serviços tomados" do portal.
-- prestador_doc / prestador_nome guardam quem prestou (só nas notas tomadas).
-- Aditiva e idempotente.

ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "papel" text DEFAULT 'prestador' NOT NULL;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "prestador_doc" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "prestador_nome" text;
