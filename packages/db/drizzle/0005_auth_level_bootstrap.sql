ALTER TABLE "user_progress"
ADD COLUMN "level" integer DEFAULT 1 NOT NULL;

ALTER TABLE "mobile_auth_exchanges"
ADD COLUMN "is_new_user" boolean DEFAULT false NOT NULL;

ALTER TABLE "mobile_auth_exchanges"
ADD COLUMN "effective_level" integer DEFAULT 1 NOT NULL;