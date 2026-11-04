-- Pedido de exclusão de conta feito pelo próprio cliente. Exigência da App
-- Store (5.1.1(v)) e do Data safety do Google. Não apaga nada: registra o
-- pedido para o contador executar depois de encerrar as obrigações fiscais.
-- Aditiva e idempotente.

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "deletion_reason" text;
