CREATE TABLE IF NOT EXISTS "payment_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
	"client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
	"status" text DEFAULT 'PENDENTE' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"check_attempts" integer DEFAULT 0 NOT NULL,
	"last_interaction_at" timestamp with time zone,
	"last_interaction_type" text,
	"last_error" text,
	"paid_detected_at" timestamp with time zone,
	"paid_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_checks_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_checks_due_idx" ON "payment_checks" USING btree ("status","next_check_at");
