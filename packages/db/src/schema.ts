import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerSubjectId: text('provider_subject_id').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    identityIndex: uniqueIndex('user_identities_provider_subject_idx').on(
      table.provider,
      table.providerSubjectId,
    ),
  }),
);

export const oauthTransactions = pgTable(
  'oauth_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    state: text('state').notNull().unique(),
    provider: text('provider').notNull(),
    purpose: text('purpose').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    redirectTo: text('redirect_to'),
    codeVerifier: text('code_verifier').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    stateIndex: uniqueIndex('oauth_transactions_state_idx').on(table.state),
  }),
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    tokenHashIndex: uniqueIndex('auth_sessions_token_hash_idx').on(table.tokenHash),
  }),
);

export const mobileAuthExchanges = pgTable(
  'mobile_auth_exchanges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull().unique(),
    sessionToken: text('session_token').notNull(),
    sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userEmail: text('user_email'),
    userDisplayName: text('user_display_name'),
    isNewUser: boolean('is_new_user').notNull().default(false),
    effectiveLevel: integer('effective_level').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    exchangeExpiresAt: timestamp('exchange_expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    codeIndex: uniqueIndex('mobile_auth_exchanges_code_idx').on(table.code),
  }),
);

export const userProgress = pgTable('user_progress', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  level: integer('level').notNull().default(1),
  streakDays: integer('streak_days').notNull().default(0),
  completedWorkouts: integer('completed_workouts').notNull().default(0),
  lastWorkoutAt: timestamp('last_workout_at', { withTimezone: true }),
  lastStreakDate: text('last_streak_date'),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userPreferences = pgTable('user_preferences', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  theme: text('theme').notNull().default('system'),
  units: text('units').notNull().default('metric'),
  reminderTime: text('reminder_time').notNull().default('07:00'),
  timezone: text('timezone'),
  payload: jsonb('payload').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notificationDevices = pgTable(
  'notification_devices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    pushToken: text('push_token').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pushTokenIndex: uniqueIndex('notification_devices_push_token_idx').on(table.pushToken),
  }),
);

export const progressEvents = pgTable('progress_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  value: jsonb('value').notNull().default({}),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workouts = pgTable('workouts', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  mode: text('mode').notNull(),
  isPublished: boolean('is_published').notNull().default(false),
  createdBy: text('created_by'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});
