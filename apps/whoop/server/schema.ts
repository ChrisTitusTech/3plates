import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
const time = (name: string) => timestamp(name, { withTimezone: true });
export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  whoopId: text("whoop_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  tokens: text("tokens"),
  connected: boolean("connected").notNull().default(true),
  shareToken: text("share_token").unique(),
  sharePolicy: jsonb("share_policy").$type<{
    kinds: string[];
    start?: string;
    end?: string;
    expires?: string;
  }>(),
  dataRevision: integer("data_revision").notNull().default(0),
  createdAt: time("created_at").notNull().defaultNow(),
  lastSync: time("last_sync"),
  lastRecent: time("last_recent"),
  lastFull: time("last_full"),
  lastCycle: time("last_cycle"),
});
export const sessions = pgTable("sessions", {
  hash: text("hash").primaryKey(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  expires: time("expires").notNull(),
});
export const oauthStates = pgTable("oauth_states", {
  hash: text("hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  memberId: uuid("member_id").references(() => members.id, {
    onDelete: "cascade",
  }),
  expires: time("expires").notNull(),
});
export const records = pgTable(
  "records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    sourceId: text("source_id").notNull(),
    cycleId: text("cycle_id"),
    sleepId: text("sleep_id"),
    start: time("start").notNull(),
    end: time("end"),
    localDate: text("local_date").notNull(),
    raw: jsonb("raw").notNull().$type<Record<string, any>>(),
    fetchedAt: time("fetched_at").notNull().defaultNow(),
    deleted: boolean("deleted").notNull().default(false),
  },
  (t) => [
    uniqueIndex("record_source").on(t.memberId, t.kind, t.sourceId),
    index("record_dates").on(t.memberId, t.localDate),
    index("record_sleep").on(t.memberId, t.sleepId),
  ],
);
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, any>>(),
    status: text("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(10),
    attempts: integer("attempts").notNull().default(0),
    count: integer("count").notNull().default(0),
    availableAt: time("available_at").notNull().defaultNow(),
    startedAt: time("started_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("job_active_key")
      .on(t.memberId, t.key)
      .where(sql`${t.status} in ('pending', 'running')`),
    index("job_ready").on(t.status, t.availableAt),
  ],
);
export const webhooks = pgTable("webhooks", {
  trace: text("trace").primaryKey(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  received: time("received").notNull().defaultNow(),
});
export const budgets = pgTable("budgets", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resets: time("resets").notNull(),
});
export const heartbeat = pgTable("heartbeat", {
  name: text("name").primaryKey(),
  at: time("at").notNull().defaultNow(),
});
