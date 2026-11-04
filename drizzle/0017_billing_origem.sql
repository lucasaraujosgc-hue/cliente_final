-- Faturamento: origem dos valores de serviços prestados/tomados (nfse | manual).
ALTER TABLE "billing_data" ADD COLUMN IF NOT EXISTS "services_revenue_origem" text;
--> statement-breakpoint
ALTER TABLE "billing_data" ADD COLUMN IF NOT EXISTS "services_taken_origem" text;
