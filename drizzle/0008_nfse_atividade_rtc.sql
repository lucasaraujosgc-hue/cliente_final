-- NFS-e: o contador passa a pré-configurar TODOS os códigos da atividade
-- (NBS, tributação do ISSQN, regime de apuração SN, PIS/COFINS, IBS/CBS) para
-- que o cliente só informe tomador + descrição + valor.
-- Aditiva e idempotente.

ALTER TABLE "nfse_atividades" ADD COLUMN IF NOT EXISTS "c_nbs" text;--> statement-breakpoint
ALTER TABLE "nfse_atividades" ADD COLUMN IF NOT EXISTS "trib_issqn" text DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "nfse_atividades" ADD COLUMN IF NOT EXISTS "reg_ap_trib_sn" text;--> statement-breakpoint
ALTER TABLE "nfse_atividades" ADD COLUMN IF NOT EXISTS "cod_atividade_sn" text;--> statement-breakpoint
ALTER TABLE "nfse_atividades" ADD COLUMN IF NOT EXISTS "pis_cofins_cst" text;--> statement-breakpoint
ALTER TABLE "nfse_atividades" ADD COLUMN IF NOT EXISTS "aliquota_pis" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "nfse_atividades" ADD COLUMN IF NOT EXISTS "aliquota_cofins" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "nfse_atividades" ADD COLUMN IF NOT EXISTS "ibs_cbs_cst" text;--> statement-breakpoint
ALTER TABLE "nfse_atividades" ADD COLUMN IF NOT EXISTS "ibs_cbs_class_trib" text;--> statement-breakpoint
ALTER TABLE "nfse_atividades" ADD COLUMN IF NOT EXISTS "ibs_cbs_cind_op" text;--> statement-breakpoint
ALTER TABLE "nfse_atividades" ADD COLUMN IF NOT EXISTS "ibs_cbs_ind_dest" text DEFAULT '0' NOT NULL;
