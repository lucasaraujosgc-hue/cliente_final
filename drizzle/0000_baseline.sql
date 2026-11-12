CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"summary" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"month" text NOT NULL,
	"services_revenue" integer DEFAULT 0 NOT NULL,
	"sales_revenue" integer DEFAULT 0 NOT NULL,
	"total_incomes" integer DEFAULT 0 NOT NULL,
	"services_taken" integer DEFAULT 0 NOT NULL,
	"revenue" integer DEFAULT 0 NOT NULL,
	"expenses" integer DEFAULT 0 NOT NULL,
	"payroll" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cnpj" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"regularity_status" text NOT NULL,
	"email" text,
	"first_access_done" boolean DEFAULT false,
	"integration_hash" text,
	"accountant_category" text,
	"notification_preferences" json DEFAULT '{"receives_all":true,"recurrent":true,"before_due":true,"on_due":true,"on_new_file":true}'::json,
	"reset_code_hash" text,
	"reset_code_expires" timestamp,
	"reset_code_attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "clients_cnpj_unique" UNIQUE("cnpj"),
	CONSTRAINT "clients_integration_hash_unique" UNIQUE("integration_hash")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"competence" text,
	"due_date" text,
	"status" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"file_url" text,
	"pix_code" text,
	"extracted_data" jsonb
);
--> statement-breakpoint
CREATE TABLE "guias_geradas" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"usuario_id" integer DEFAULT 1 NOT NULL,
	"tipo_guia" text NOT NULL,
	"competencia" text NOT NULL,
	"status" text DEFAULT 'PENDENTE',
	"pdf_path" text,
	"data_vencimento" text,
	"valor_total" real,
	"numero_documento" text,
	"erro_msg" text,
	"created_at" timestamp DEFAULT now(),
	"concluido_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"content" text NOT NULL,
	"direction" text DEFAULT 'accountant_to_client' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"schedule_day" integer,
	"schedule_time" text,
	"last_sent" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serpro_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer DEFAULT 1 NOT NULL,
	"consumer_key" text,
	"consumer_secret" text,
	"cert_path" text,
	"cert_senha" text,
	"cnpj_contratante" text,
	"ambiente" text DEFAULT 'trial',
	"whatsapp_support" text,
	"multiple_files_text" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"subscription_object" jsonb,
	"fcm_token" text,
	"device_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_data" ADD CONSTRAINT "billing_data_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guias_geradas" ADD CONSTRAINT "guias_geradas_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;