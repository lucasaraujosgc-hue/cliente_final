CREATE TABLE IF NOT EXISTS "nfse_atividades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
	"nome" text NOT NULL,
	"item_lista_servico" text NOT NULL,
	"cod_tributacao_nac" text,
	"cod_tributacao_mun" text,
	"cnae" text,
	"descricao_padrao" text DEFAULT '' NOT NULL,
	"aliquota_iss" real DEFAULT 0 NOT NULL,
	"iss_retido" boolean DEFAULT false NOT NULL,
	"exigibilidade_iss" text DEFAULT '1' NOT NULL,
	"municipio_incidencia" text,
	"ret_irrf" real DEFAULT 0 NOT NULL,
	"ret_pis" real DEFAULT 0 NOT NULL,
	"ret_cofins" real DEFAULT 0 NOT NULL,
	"ret_csll" real DEFAULT 0 NOT NULL,
	"ret_inss" real DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nfse_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
	"ativo" boolean DEFAULT false NOT NULL,
	"ambiente" text DEFAULT 'homologacao' NOT NULL,
	"cert_path" text,
	"cert_senha" text,
	"cert_cnpj" text,
	"cert_validade_ate" timestamp with time zone,
	"codigo_municipio" text,
	"regime_tributario" text DEFAULT 'simples_nacional' NOT NULL,
	"regime_especial_trib" text,
	"optante_simples_nacional" boolean DEFAULT true NOT NULL,
	"incentivo_fiscal" boolean DEFAULT false NOT NULL,
	"serie_dps" text DEFAULT '00001' NOT NULL,
	"prox_numero_dps" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_config_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "atividade_id" uuid REFERENCES "nfse_atividades"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "ambiente" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "aliquota_iss" real;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "valor_iss" integer;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "tomador_email" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "tomador_telefone" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "tomador_endereco" jsonb;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "serie_dps" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "numero_dps" integer;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "id_dps" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "chave_acesso" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "data_emissao" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "xml_dps" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "xml_nfse" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "danfse_pdf_path" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "rejeicao_codigo" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "rejeicao_motivo" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "cancelada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "cancelamento_motivo" text;--> statement-breakpoint
ALTER TABLE "nfse_emissoes" ADD COLUMN IF NOT EXISTS "substitui_chave" text;
