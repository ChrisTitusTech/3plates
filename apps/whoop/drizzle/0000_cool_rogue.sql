CREATE TABLE "budgets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"resets" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "heartbeat" (
	"name" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 10 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"whoop_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"tokens" text,
	"connected" boolean DEFAULT true NOT NULL,
	"share_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync" timestamp with time zone,
	"last_recent" timestamp with time zone,
	"last_full" timestamp with time zone,
	"last_cycle" timestamp with time zone,
	CONSTRAINT "members_whoop_id_unique" UNIQUE("whoop_id"),
	CONSTRAINT "members_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"hash" text PRIMARY KEY NOT NULL,
	"browser_hash" text NOT NULL,
	"member_id" uuid,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"cycle_id" text,
	"sleep_id" text,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone,
	"local_date" text NOT NULL,
	"raw" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"hash" text PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"trace" text PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"received" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_active_key" ON "jobs" USING btree ("member_id","key") WHERE "jobs"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "job_ready" ON "jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "record_source" ON "records" USING btree ("member_id","kind","source_id");--> statement-breakpoint
CREATE INDEX "record_dates" ON "records" USING btree ("member_id","local_date");--> statement-breakpoint
CREATE INDEX "record_sleep" ON "records" USING btree ("member_id","sleep_id");