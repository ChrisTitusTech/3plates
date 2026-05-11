import {
  notificationDeviceSchema,
  preferencesSchema,
  progressSchema,
  userSchema,
} from '@3plates/contract';
import { createDatabaseClient } from '@3plates/db';
import {
  notificationDevices,
  userPreferences,
  userProgress,
  users,
} from '@3plates/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const userIdentitySchema = z.object({
  email: z.string().email(),
  displayName: z.string().nullable(),
});

export type UserIdentityInput = z.infer<typeof userIdentitySchema>;
export type UserRecord = z.infer<typeof userSchema>;
export type ProgressRecord = z.infer<typeof progressSchema>;
export type PreferencesRecord = z.infer<typeof preferencesSchema>;
export type NotificationDeviceRecord = z.infer<typeof notificationDeviceSchema>;

export interface UserStateStore {
  getOrCreateUser(input: UserIdentityInput): Promise<UserRecord>;
  getProgress(userId: string): Promise<ProgressRecord>;
  updateProgress(userId: string, progress: ProgressRecord): Promise<void>;
  getPreferences(userId: string): Promise<PreferencesRecord>;
  updatePreferences(userId: string, preferences: PreferencesRecord): Promise<void>;
  registerDevice(userId: string, device: NotificationDeviceRecord): Promise<void>;
  close?(): Promise<void>;
}

const defaultProgress = Object.freeze<ProgressRecord>({
  streakDays: 0,
  completedWorkouts: 0,
  lastWorkoutAt: null,
});

const defaultPreferences = Object.freeze<PreferencesRecord>({
  theme: 'system',
  units: 'metric',
  reminderTime: '07:00',
});

function mapUser(row: { id: string; email: string; displayName: string | null }): UserRecord {
  return userSchema.parse({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
  });
}

function mapProgress(row: {
  streakDays: number;
  completedWorkouts: number;
  lastWorkoutAt: Date | null;
}): ProgressRecord {
  return progressSchema.parse({
    streakDays: row.streakDays,
    completedWorkouts: row.completedWorkouts,
    lastWorkoutAt: row.lastWorkoutAt?.toISOString() ?? null,
  });
}

function mapPreferences(row: {
  theme: string;
  units: string;
  reminderTime: string;
}): PreferencesRecord {
  return preferencesSchema.parse({
    theme: row.theme,
    units: row.units,
    reminderTime: row.reminderTime,
  });
}

export function createDbUserStateStore(connectionString: string): UserStateStore {
  const { db, close } = createDatabaseClient(connectionString);

  return {
    async getOrCreateUser(input) {
      const identity = userIdentitySchema.parse(input);
      const [existingUser] = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        })
        .from(users)
        .where(eq(users.email, identity.email))
        .limit(1);

      if (existingUser) {
        if (identity.displayName !== existingUser.displayName) {
          const [updatedUser] = await db
            .update(users)
            .set({
              displayName: identity.displayName,
              updatedAt: new Date(),
            })
            .where(eq(users.id, existingUser.id))
            .returning({
              id: users.id,
              email: users.email,
              displayName: users.displayName,
            });

          return mapUser(updatedUser);
        }

        return mapUser(existingUser);
      }

      const [createdUser] = await db
        .insert(users)
        .values({
          email: identity.email,
          displayName: identity.displayName,
        })
        .returning({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        });

      return mapUser(createdUser);
    },

    async getProgress(userId) {
      const [progress] = await db
        .select({
          streakDays: userProgress.streakDays,
          completedWorkouts: userProgress.completedWorkouts,
          lastWorkoutAt: userProgress.lastWorkoutAt,
        })
        .from(userProgress)
        .where(eq(userProgress.userId, userId))
        .limit(1);

      if (progress) {
        return mapProgress(progress);
      }

      const [createdProgress] = await db
        .insert(userProgress)
        .values({
          userId,
          streakDays: defaultProgress.streakDays,
          completedWorkouts: defaultProgress.completedWorkouts,
          lastWorkoutAt: null,
        })
        .returning({
          streakDays: userProgress.streakDays,
          completedWorkouts: userProgress.completedWorkouts,
          lastWorkoutAt: userProgress.lastWorkoutAt,
        });

      return mapProgress(createdProgress);
    },

    async updateProgress(userId, progress) {
      const payload = progressSchema.parse(progress);

      await db
        .insert(userProgress)
        .values({
          userId,
          streakDays: payload.streakDays,
          completedWorkouts: payload.completedWorkouts,
          lastWorkoutAt: payload.lastWorkoutAt ? new Date(payload.lastWorkoutAt) : null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userProgress.userId,
          set: {
            streakDays: payload.streakDays,
            completedWorkouts: payload.completedWorkouts,
            lastWorkoutAt: payload.lastWorkoutAt ? new Date(payload.lastWorkoutAt) : null,
            updatedAt: new Date(),
          },
        });
    },

    async getPreferences(userId) {
      const [preferences] = await db
        .select({
          theme: userPreferences.theme,
          units: userPreferences.units,
          reminderTime: userPreferences.reminderTime,
        })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1);

      if (preferences) {
        return mapPreferences(preferences);
      }

      const [createdPreferences] = await db
        .insert(userPreferences)
        .values({
          userId,
          theme: defaultPreferences.theme,
          units: defaultPreferences.units,
          reminderTime: defaultPreferences.reminderTime,
          updatedAt: new Date(),
        })
        .returning({
          theme: userPreferences.theme,
          units: userPreferences.units,
          reminderTime: userPreferences.reminderTime,
        });

      return mapPreferences(createdPreferences);
    },

    async updatePreferences(userId, preferences) {
      const payload = preferencesSchema.parse(preferences);

      await db
        .insert(userPreferences)
        .values({
          userId,
          theme: payload.theme,
          units: payload.units,
          reminderTime: payload.reminderTime,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: {
            theme: payload.theme,
            units: payload.units,
            reminderTime: payload.reminderTime,
            updatedAt: new Date(),
          },
        });
    },

    async registerDevice(userId, device) {
      const payload = notificationDeviceSchema.parse(device);

      await db
        .insert(notificationDevices)
        .values({
          userId,
          platform: payload.platform,
          pushToken: payload.pushToken,
          enabled: true,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: notificationDevices.pushToken,
          set: {
            userId,
            platform: payload.platform,
            enabled: true,
            lastSeenAt: new Date(),
          },
        });
    },

    close,
  };
}

type MemoryUser = UserRecord;

export function createMemoryUserStateStore(): UserStateStore & {
  listDevicesForUser(userId: string): NotificationDeviceRecord[];
} {
  const usersByEmail = new Map<string, MemoryUser>();
  const progressByUserId = new Map<string, ProgressRecord>();
  const preferencesByUserId = new Map<string, PreferencesRecord>();
  const devicesByToken = new Map<string, NotificationDeviceRecord & { userId: string }>();

  return {
    async getOrCreateUser(input) {
      const identity = userIdentitySchema.parse(input);
      const existingUser = usersByEmail.get(identity.email);

      if (existingUser) {
        const updatedUser = {
          ...existingUser,
          displayName: identity.displayName,
        } satisfies MemoryUser;

        usersByEmail.set(identity.email, updatedUser);
        return updatedUser;
      }

      const createdUser = userSchema.parse({
        id: crypto.randomUUID(),
        email: identity.email,
        displayName: identity.displayName,
      });

      usersByEmail.set(createdUser.email ?? identity.email, createdUser);
      return createdUser;
    },

    async getProgress(userId) {
      return progressByUserId.get(userId) ?? defaultProgress;
    },

    async updateProgress(userId, progress) {
      progressByUserId.set(userId, progressSchema.parse(progress));
    },

    async getPreferences(userId) {
      return preferencesByUserId.get(userId) ?? defaultPreferences;
    },

    async updatePreferences(userId, preferences) {
      preferencesByUserId.set(userId, preferencesSchema.parse(preferences));
    },

    async registerDevice(userId, device) {
      const payload = notificationDeviceSchema.parse(device);
      devicesByToken.set(payload.pushToken, {
        ...payload,
        userId,
      });
    },

    listDevicesForUser(userId) {
      return Array.from(devicesByToken.values())
        .filter((device) => device.userId === userId)
        .map(({ platform, pushToken }) => ({ platform, pushToken }));
    },

    async close() {
      return undefined;
    },
  };
}