ALTER TABLE "auth_sessions" ADD COLUMN "auth_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD COLUMN "auth_generation" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_generation" integer DEFAULT 0 NOT NULL;