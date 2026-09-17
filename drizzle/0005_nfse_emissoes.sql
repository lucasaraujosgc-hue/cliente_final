CREATE TABLE IF NOT EXISTS "nfse_emissoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"competencia" text,
	"valor_servicos" integer,
	"descricao" text,
	"tomador_doc" text,
	"tomador_nome" text,
	"numero_nota" text,
	"codigo_verificacao" text,
	"provider_ref" text,
	"xml" text,
	"pdf_url" text,
	"erro_msg" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
