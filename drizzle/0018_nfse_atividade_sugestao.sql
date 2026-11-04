-- NFS-e: atividade sugerida pelo sistema (notas anteriores / CNAE), a conferir.
ALTER TABLE "nfse_atividades" ADD COLUMN IF NOT EXISTS "sugestao" jsonb;
