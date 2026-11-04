-- Painel de pendências fiscais (services/fiscal/). Só tabelas novas;
-- aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "fiscal_eventos" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"evento" text NOT NULL,
	"ultima_data" text NOT NULL,
	"verificado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_execucoes" (
	"chave" text PRIMARY KEY NOT NULL,
	"executado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"resultado" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_notificacoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"processo" text NOT NULL,
	"titulo" text NOT NULL,
	"descricao" text NOT NULL,
	"lida" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_perfil" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"regime" text,
	"processos" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"processo" text NOT NULL,
	"competencia" text,
	"status" text NOT NULL,
	"resumo" text NOT NULL,
	"detalhes" jsonb,
	"fonte" text NOT NULL,
	"verificado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parcelamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"modalidade" text NOT NULL,
	"numero" text NOT NULL,
	"situacao" text,
	"origem" text NOT NULL,
	"valor_parcela" real,
	"parcelas_total" integer,
	"dia_vencimento" integer,
	"ultimo_pagamento" text,
	"detalhes" jsonb,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "serpro_uso" (
	"id" serial PRIMARY KEY NOT NULL,
	"id_sistema" text NOT NULL,
	"id_servico" text NOT NULL,
	"client_id" uuid,
	"ok" boolean NOT NULL,
	"origem" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_eventos" ADD CONSTRAINT "fiscal_eventos_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_notificacoes" ADD CONSTRAINT "fiscal_notificacoes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_perfil" ADD CONSTRAINT "fiscal_perfil_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_status" ADD CONSTRAINT "fiscal_status_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_eventos_cliente_evento_uq" ON "fiscal_eventos" USING btree ("client_id","evento");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fiscal_notificacoes_created_idx" ON "fiscal_notificacoes" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_status_cliente_processo_uq" ON "fiscal_status" USING btree ("client_id","processo");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "parcelamentos_cliente_modalidade_numero_uq" ON "parcelamentos" USING btree ("client_id","modalidade","numero");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "serpro_uso_created_idx" ON "serpro_uso" USING btree ("created_at");
