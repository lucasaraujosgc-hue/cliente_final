-- hand-edited to IF NOT EXISTS: during the transition initDb() may have
-- already created this table (see MIGRATIONS.md).
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"summary" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
