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

export const authSessionSchema = z.object({
  sessionToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  user: userSchema,
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
      200: userSchema,
    },
  },
  progress: {
    method: 'GET',
    path: '/users/me/progress',
    responses: {
      200: progressSchema,
    },
  },
  updateProgress: {
    method: 'PUT',
    path: '/users/me/progress',
    body: progressSchema,
    responses: {
      200: z.object({
        updated: z.literal(true),
      }),
    },
  },
  preferences: {
    method: 'GET',
    path: '/users/me/preferences',
    responses: {
      200: preferencesSchema,
    },
  },
  updatePreferences: {
    method: 'PUT',
    path: '/users/me/preferences',
    body: preferencesSchema,
    responses: {
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
      200: z.object({
        registered: z.literal(true),
      }),
    },
  },
});

export type AppContract = typeof appContract;
