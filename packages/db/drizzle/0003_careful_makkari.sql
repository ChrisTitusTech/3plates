CREATE TABLE "mobile_auth_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"session_token" text NOT NULL,
	"session_expires_at" timestamp with time zone NOT NULL,
	"user_id" uuid NOT NULL,
	"user_email" text,
	"user_display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exchange_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mobile_auth_exchanges_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "mobile_auth_exchanges" ADD CONSTRAINT "mobile_auth_exchanges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_auth_exchanges_code_idx" ON "mobile_auth_exchanges" USING btree ("code");