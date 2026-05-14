import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

export const authProviderSchema = z.enum(['google', 'apple']);

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email().nullable(),
  displayName: z.string().nullable(),
});

export const progressSchema = z.object({
  streakDays: z.number().int().nonnegative(),
  completedWorkouts: z.number().int().nonnegative(),
  lastWorkoutAt: z.string().datetime().nullable(),
});

export const preferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  units: z.enum(['metric', 'imperial']),
  reminderTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export const notificationDeviceSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  pushToken: z.string().min(1),
});

export const workoutModeSchema = z.enum(['active_recovery', 'strength_metcon']);

export const workoutSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable(),
  mode: workoutModeSchema,
  isPublished: z.boolean(),
});

export const apiErrorCodeSchema = z.enum([
  'invalid_auth',
  'invalid_request_payload',
  'missing_user_state',
  'conflict_or_stale_update',
  'internal_error',
]);

export const apiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
  }),
});

export const authSessionSchema = z.object({
  sessionToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  user: userSchema,
  isNewUser: z.boolean(),
  effectiveLevel: z.number().int().min(1),
});

export const appContract = c.router({
  health: {
    method: 'GET',
    path: '/health',
    responses: {
      200: z.object({
        status: z.literal('ok'),
        timestamp: z.string().datetime(),
      }),
    },
  },
  authStart: {
    method: 'POST',
    path: '/auth/start',
    body: z.object({
      provider: authProviderSchema,
      redirectTo: z.string().url().optional(),
    }),
    responses: {
      400: apiErrorSchema,
      200: z.object({
        ok: z.literal(true),
        provider: authProviderSchema,
        next: z.string(),
        state: z.string(),
      }),
    },
  },
  authLinkStart: {
    method: 'POST',
    path: '/auth/link',
    body: z.object({
      provider: authProviderSchema,
      redirectTo: z.string().url().optional(),
    }),
    responses: {
      400: apiErrorSchema,
      401: apiErrorSchema,
      200: z.object({
        ok: z.literal(true),
        provider: authProviderSchema,
        next: z.string(),
        state: z.string(),
      }),
    },
  },
  authCallback: {
    method: 'GET',
    path: '/auth/callback',
    query: z.object({
      provider: authProviderSchema,
      code: z.string().min(1),
      state: z.string().min(1),
    }),
    responses: {
      400: apiErrorSchema,
      404: apiErrorSchema,
      409: apiErrorSchema,
      200: z.object({
        ok: z.literal(true),
        provider: authProviderSchema,
        redirectTo: z.string().nullable(),
        ...authSessionSchema.shape,
      }),
    },
  },
  authRefresh: {
    method: 'POST',
    path: '/auth/refresh',
    body: z.object({}),
    responses: {
      401: apiErrorSchema,
      404: apiErrorSchema,
      200: z.object({
        ok: z.literal(true),
        ...authSessionSchema.shape,
      }),
    },
  },
  authExchange: {
    method: 'POST',
    path: '/auth/exchange',
    body: z.object({
      code: z.string().min(1),
    }),
    responses: {
      400: apiErrorSchema,
      409: apiErrorSchema,
      200: z.object({
        ok: z.literal(true),
        ...authSessionSchema.shape,
      }),
    },
  },
  me: {
    method: 'GET',
    path: '/users/me',
    responses: {
      401: apiErrorSchema,
      404: apiErrorSchema,
      200: userSchema,
    },
  },
  progress: {
    method: 'GET',
    path: '/users/me/progress',
    responses: {
      401: apiErrorSchema,
      404: apiErrorSchema,
      200: progressSchema,
    },
  },
  updateProgress: {
    method: 'PUT',
    path: '/users/me/progress',
    body: progressSchema,
    responses: {
      400: apiErrorSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
      409: apiErrorSchema,
      200: z.object({
        updated: z.literal(true),
      }),
    },
  },
  preferences: {
    method: 'GET',
    path: '/users/me/preferences',
    responses: {
      401: apiErrorSchema,
      404: apiErrorSchema,
      200: preferencesSchema,
    },
  },
  updatePreferences: {
    method: 'PUT',
    path: '/users/me/preferences',
    body: preferencesSchema,
    responses: {
      400: apiErrorSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
      409: apiErrorSchema,
      200: z.object({
        updated: z.literal(true),
      }),
    },
  },
  registerDevice: {
    method: 'POST',
    path: '/notifications/devices',
    body: notificationDeviceSchema,
    responses: {
      400: apiErrorSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
      409: apiErrorSchema,
      200: z.object({
        registered: z.literal(true),
      }),
    },
  },
  workoutsByMode: {
    method: 'GET',
    path: '/workouts',
    query: z.object({
      mode: workoutModeSchema,
    }),
    responses: {
      400: apiErrorSchema,
      401: apiErrorSchema,
      200: z.object({
        workouts: z.array(workoutSchema),
      }),
    },
  },
});

export type AppContract = typeof appContract;
export type AuthProvider = z.infer<typeof authProviderSchema>;
export type User = z.infer<typeof userSchema>;
export type Progress = z.infer<typeof progressSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type NotificationDevice = z.infer<typeof notificationDeviceSchema>;
export type WorkoutMode = z.infer<typeof workoutModeSchema>;
export type Workout = z.infer<typeof workoutSchema>;
