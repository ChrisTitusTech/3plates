ALTER TABLE "user_preferences" ADD COLUMN "timezone" text;
--> statement-breakpoint
ALTER TABLE "user_progress" ADD COLUMN "last_streak_date" text;