-- NFS-e: emitir com o certificado do escritório (procuração eletrônica RFB, serviço NFS-e).
ALTER TABLE "nfse_config" ADD COLUMN IF NOT EXISTS "usar_procuracao" boolean DEFAULT false NOT NULL;
