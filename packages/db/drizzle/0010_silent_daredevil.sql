ALTER TABLE "mobile_auth_exchanges" ADD COLUMN "exchange_challenge" text;--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD COLUMN "exchange_challenge" text;