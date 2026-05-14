import {
  notificationDeviceSchema,
  preferencesSchema,
  progressSchema,
  workoutModeSchema,
  workoutSchema,
  userSchema,
} from '@3plates/contract';
import { createDatabaseClient } from '@3plates/db';
import {
  notificationDevices,
  userIdentities,
  userPreferences,
  userProgress,
  users,
  workouts,
} from '@3plates/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { conflictOrStaleUpdateError, missingUserStateError } from './api-error.js';
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
export type WorkoutMode = z.infer<typeof workoutModeSchema>;
export type WorkoutRecord = z.infer<typeof workoutSchema>;
export type AuthBootstrapResult = {
  user: UserRecord;
  isNewUser: boolean;
  effectiveLevel: number;
};

export interface UserStateStore {
  getOrCreateUser(input: UserIdentityInput): Promise<UserRecord>;
  getUserById(userId: string): Promise<UserRecord | null>;
  resolveOAuthIdentity(input: OAuthIdentity & { linkedUserId?: string | null }): Promise<AuthBootstrapResult>;
  getUserEffectiveLevel(userId: string): Promise<number>;
  getProgress(userId: string): Promise<ProgressRecord>;
  updateProgress(userId: string, progress: ProgressRecord): Promise<void>;
  getPreferences(userId: string): Promise<PreferencesRecord>;
  updatePreferences(userId: string, preferences: PreferencesRecord): Promise<void>;
  registerDevice(userId: string, device: NotificationDeviceRecord): Promise<void>;
  listWorkouts(mode: WorkoutMode): Promise<WorkoutRecord[]>;
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

function mapWorkout(row: {
  id: string;
  title: string;
  description: string | null;
  mode: string;
  isPublished: boolean;
}): WorkoutRecord {
  return workoutSchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    mode: row.mode,
    isPublished: row.isPublished,
  });
}

export function createDbUserStateStore(connectionString: string): UserStateStore {
  const { db, close } = createDatabaseClient(connectionString);

  const getOrCreateUserLevel = async (executor: typeof db, userId: string): Promise<number> => {
    const [existingProgress] = await executor
      .select({
        level: userProgress.level,
      })
      .from(userProgress)
      .where(eq(userProgress.userId, userId))
      .limit(1);

    if (existingProgress) {
      return existingProgress.level;
    }

    const [createdProgress] = await executor
      .insert(userProgress)
      .values({
        userId,
        level: 1,
      })
      .returning({
        level: userProgress.level,
      });

    return createdProgress.level;
  };

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
            throw missingUserStateError('Identity references a missing user.');
          }

          const effectiveLevel = await getOrCreateUserLevel(transaction, user.id);
          return {
            user,
            isNewUser: false,
            effectiveLevel,
          };
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
            throw conflictOrStaleUpdateError('Identity is already linked to another account.');
          }

          await transaction.insert(userIdentities).values({
            userId: identity.linkedUserId,
            provider: identity.provider,
            providerSubjectId: identity.providerSubjectId,
            email: identity.email,
          });

          const linkedUser = await getUserById(identity.linkedUserId);
          if (!linkedUser) {
            throw missingUserStateError('Linked account is missing.');
          }

          const effectiveLevel = await getOrCreateUserLevel(transaction, linkedUser.id);
          return {
            user: linkedUser,
            isNewUser: false,
            effectiveLevel,
          };
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

            const user = mapUser(existingUserByEmail);
            const effectiveLevel = await getOrCreateUserLevel(transaction, user.id);
            return {
              user,
              isNewUser: false,
              effectiveLevel,
            };
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

        const effectiveLevel = await getOrCreateUserLevel(transaction, createdUser.id);

        return {
          user: mapUser(createdUser),
          isNewUser: true,
          effectiveLevel,
        };
      });
    },

    async getUserEffectiveLevel(userId) {
      return getOrCreateUserLevel(db, userId);
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

    async listWorkouts(mode) {
      const selectedMode = workoutModeSchema.parse(mode);
      const rows = await db
        .select({
          id: workouts.id,
          title: workouts.title,
          description: workouts.description,
          mode: workouts.mode,
          isPublished: workouts.isPublished,
        })
        .from(workouts)
        .where(and(eq(workouts.mode, selectedMode), eq(workouts.isPublished, true)))
        .orderBy(desc(workouts.publishedAt), desc(workouts.createdAt));

      return rows.map(mapWorkout);
    },

    close,
  };
}

type MemoryUser = UserRecord;

export function createMemoryUserStateStore(): UserStateStore & {
  listDevicesForUser(userId: string): NotificationDeviceRecord[];
  seedWorkout(workout: WorkoutRecord): void;
} {
  const usersByEmail = new Map<string, MemoryUser>();
  const usersById = new Map<string, MemoryUser>();
  const identitiesByKey = new Map<string, string>();
  const progressByUserId = new Map<string, ProgressRecord>();
  const preferencesByUserId = new Map<string, PreferencesRecord>();
  const devicesByToken = new Map<string, NotificationDeviceRecord & { userId: string }>();
  const workoutsById = new Map<string, WorkoutRecord>();
  const levelsByUserId = new Map<string, number>();

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
          throw missingUserStateError('Identity references a missing user.');
        }

        const effectiveLevel = levelsByUserId.get(existingUser.id) ?? 1;
        levelsByUserId.set(existingUser.id, effectiveLevel);
        return {
          user: existingUser,
          isNewUser: false,
          effectiveLevel,
        };
      }

      if (input.linkedUserId) {
        const linkedUser = usersById.get(input.linkedUserId);
        if (!linkedUser) {
          throw missingUserStateError('Linked account is missing.');
        }

        identitiesByKey.set(identityKey(input.provider, input.providerSubjectId), linkedUser.id);
        const effectiveLevel = levelsByUserId.get(linkedUser.id) ?? 1;
        levelsByUserId.set(linkedUser.id, effectiveLevel);
        return {
          user: linkedUser,
          isNewUser: false,
          effectiveLevel,
        };
      }

      if (input.email && input.emailVerified) {
        const existingUserByEmail = usersByEmail.get(input.email);
        if (existingUserByEmail) {
          identitiesByKey.set(identityKey(input.provider, input.providerSubjectId), existingUserByEmail.id);
          const effectiveLevel = levelsByUserId.get(existingUserByEmail.id) ?? 1;
          levelsByUserId.set(existingUserByEmail.id, effectiveLevel);
          return {
            user: existingUserByEmail,
            isNewUser: false,
            effectiveLevel,
          };
        }
      }

      const createdUser = userSchema.parse({
        id: crypto.randomUUID(),
        email: input.email ?? `${input.providerSubjectId}@${input.provider}.local`,
        displayName: input.displayName,
      });

      const createdEmail = createdUser.email ?? `${input.providerSubjectId}@${input.provider}.local`;
      usersByEmail.set(createdEmail, createdUser);
      usersById.set(createdUser.id, createdUser);
      identitiesByKey.set(identityKey(input.provider, input.providerSubjectId), createdUser.id);
      levelsByUserId.set(createdUser.id, 1);
      return {
        user: createdUser,
        isNewUser: true,
        effectiveLevel: 1,
      };
    },

    async getUserEffectiveLevel(userId) {
      const effectiveLevel = levelsByUserId.get(userId) ?? 1;
      levelsByUserId.set(userId, effectiveLevel);
      return effectiveLevel;
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

    async listWorkouts(mode) {
      const selectedMode = workoutModeSchema.parse(mode);
      return Array.from(workoutsById.values())
        .filter((workout) => workout.isPublished && workout.mode === selectedMode)
        .sort((a, b) => a.title.localeCompare(b.title));
    },

    seedWorkout(workout) {
      const payload = workoutSchema.parse(workout);
      workoutsById.set(payload.id, payload);
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