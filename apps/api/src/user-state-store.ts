import {
  notificationDeviceSchema,
  preferencesSchema,
  progressSchema,
  userSchema,
} from '@3plates/contract';
import { createDatabaseClient } from '@3plates/db';
import {
  notificationDevices,
  userIdentities,
  userPreferences,
  userProgress,
  users,
} from '@3plates/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { OAuthIdentity } from './auth-types.js';

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
  getUserById(userId: string): Promise<UserRecord | null>;
  resolveOAuthIdentity(input: OAuthIdentity & { linkedUserId?: string | null }): Promise<UserRecord>;
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

  const getUserById = async (userId: string): Promise<UserRecord | null> => {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user ? mapUser(user) : null;
  };

  return {
    getUserById,

    async resolveOAuthIdentity(input) {
      const identity = input;

      return db.transaction(async (transaction) => {
        const [existingIdentity] = await transaction
          .select({
            userId: userIdentities.userId,
          })
          .from(userIdentities)
          .where(
            and(
              eq(userIdentities.provider, identity.provider),
              eq(userIdentities.providerSubjectId, identity.providerSubjectId),
            ),
          )
          .limit(1);

        if (existingIdentity) {
          const user = await getUserById(existingIdentity.userId);
          if (!user) {
            throw new Error('Identity references a missing user.');
          }
          return user;
        }

        if (identity.linkedUserId) {
          const [linkedIdentity] = await transaction
            .select({
              userId: userIdentities.userId,
            })
            .from(userIdentities)
            .where(
              and(
                eq(userIdentities.provider, identity.provider),
                eq(userIdentities.providerSubjectId, identity.providerSubjectId),
              ),
            )
            .limit(1);

          if (linkedIdentity && linkedIdentity.userId !== identity.linkedUserId) {
            throw new Error('Identity is already linked to another account.');
          }

          await transaction.insert(userIdentities).values({
            userId: identity.linkedUserId,
            provider: identity.provider,
            providerSubjectId: identity.providerSubjectId,
            email: identity.email,
          });

          const linkedUser = await getUserById(identity.linkedUserId);
          if (!linkedUser) {
            throw new Error('Linked account is missing.');
          }

          return linkedUser;
        }

        if (identity.email && identity.emailVerified) {
          const [existingUserByEmail] = await transaction
            .select({
              id: users.id,
              email: users.email,
              displayName: users.displayName,
            })
            .from(users)
            .where(eq(users.email, identity.email))
            .limit(1);

          if (existingUserByEmail) {
            await transaction.insert(userIdentities).values({
              userId: existingUserByEmail.id,
              provider: identity.provider,
              providerSubjectId: identity.providerSubjectId,
              email: identity.email,
            });

            return mapUser(existingUserByEmail);
          }
        }

        const [createdUser] = await transaction
          .insert(users)
          .values({
            email: identity.email ?? `${identity.providerSubjectId}@${identity.provider}.local`,
            displayName: identity.displayName,
          })
          .returning({
            id: users.id,
            email: users.email,
            displayName: users.displayName,
          });

        await transaction.insert(userIdentities).values({
          userId: createdUser.id,
          provider: identity.provider,
          providerSubjectId: identity.providerSubjectId,
          email: identity.email,
        });

        return mapUser(createdUser);
      });
    },

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
  const usersById = new Map<string, MemoryUser>();
  const identitiesByKey = new Map<string, string>();
  const progressByUserId = new Map<string, ProgressRecord>();
  const preferencesByUserId = new Map<string, PreferencesRecord>();
  const devicesByToken = new Map<string, NotificationDeviceRecord & { userId: string }>();

  function identityKey(provider: string, providerSubjectId: string) {
    return `${provider}:${providerSubjectId}`;
  }

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
        usersById.set(updatedUser.id, updatedUser);
        return updatedUser;
      }

      const createdUser = userSchema.parse({
        id: crypto.randomUUID(),
        email: identity.email,
        displayName: identity.displayName,
      });

      usersByEmail.set(createdUser.email ?? identity.email, createdUser);
      usersById.set(createdUser.id, createdUser);
      return createdUser;
    },

    async getUserById(userId) {
      return usersById.get(userId) ?? null;
    },

    async resolveOAuthIdentity(input) {
      const existingUserId = identitiesByKey.get(identityKey(input.provider, input.providerSubjectId));
      if (existingUserId) {
        const existingUser = usersById.get(existingUserId);
        if (!existingUser) {
          throw new Error('Identity references a missing user.');
        }

        return existingUser;
      }

      if (input.linkedUserId) {
        const linkedUser = usersById.get(input.linkedUserId);
        if (!linkedUser) {
          throw new Error('Linked account is missing.');
        }

        identitiesByKey.set(identityKey(input.provider, input.providerSubjectId), linkedUser.id);
        return linkedUser;
      }

      if (input.email && input.emailVerified) {
        const existingUserByEmail = usersByEmail.get(input.email);
        if (existingUserByEmail) {
          identitiesByKey.set(identityKey(input.provider, input.providerSubjectId), existingUserByEmail.id);
          return existingUserByEmail;
        }
      }

      const createdUser = userSchema.parse({
        id: crypto.randomUUID(),
        email: input.email ?? `${input.providerSubjectId}@${input.provider}.local`,
        displayName: input.displayName,
      });

      usersByEmail.set(createdUser.email, createdUser);
      usersById.set(createdUser.id, createdUser);
      identitiesByKey.set(identityKey(input.provider, input.providerSubjectId), createdUser.id);
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