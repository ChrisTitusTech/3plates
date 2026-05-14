ALTER TABLE "workouts" ADD COLUMN "created_by" text;
--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "version" integer NOT NULL DEFAULT 1;