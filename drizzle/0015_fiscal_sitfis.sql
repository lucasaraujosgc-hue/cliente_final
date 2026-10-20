-- Relatórios de Situação Fiscal (SITFIS) do painel fiscal. Tabela nova;
-- aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "fiscal_sitfis" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"ok" boolean NOT NULL,
	"pdf_path" text,
	"resultado" jsonb,
	"erro" text,
	"origem" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_sitfis" ADD CONSTRAINT "fiscal_sitfis_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fiscal_sitfis_cliente_created_idx" ON "fiscal_sitfis" USING btree ("client_id","created_at");
