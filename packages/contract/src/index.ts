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
  timezone: z.string().nullable().optional(),
});

export const notificationDeviceSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  pushToken: z.string().min(1),
});

export const workoutModeSchema = z.enum(['active_recovery', 'strength_metcon']);

export const workoutListOrderSchema = z.enum([
  'published_at_desc_created_at_desc_id_asc',
]);

export const workoutListQuerySchema = z.object({
  mode: workoutModeSchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  order: workoutListOrderSchema.default('published_at_desc_created_at_desc_id_asc'),
});

export const workoutSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable(),
  mode: workoutModeSchema,
  isPublished: z.boolean(),
});

export const adminWorkoutSchema = workoutSchema.extend({
  version: z.number().int().min(1),
  createdBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
});

export const adminWorkoutCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  mode: workoutModeSchema,
  isPublished: z.boolean().optional().default(false),
});

export const adminWorkoutUpdateSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    mode: workoutModeSchema.optional(),
  })
  .refine((value) => value.title !== undefined || value.description !== undefined || value.mode !== undefined, {
    message: 'At least one workout field must be provided.',
  });

export const adminWorkoutPublishSchema = z.object({
  expectedVersion: z.number().int().min(1),
});

export const workoutListResponseSchema = z.object({
  workouts: z.array(workoutSchema),
  pagination: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(50),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
  }),
  ordering: z.object({
    applied: workoutListOrderSchema,
  }),
});

export const apiErrorCodeSchema = z.enum([
  'invalid_auth',
  'admin_auth_required',
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
      provider: authProviderSchema.optional(),
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
  authSignOut: {
    method: 'POST',
    path: '/auth/sign-out',
    body: z.object({}),
    responses: {
      401: apiErrorSchema,
      200: z.object({
        signedOut: z.literal(true),
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
    query: workoutListQuerySchema,
    responses: {
      400: apiErrorSchema,
      401: apiErrorSchema,
      200: workoutListResponseSchema,
    },
  },
  adminCreateWorkout: {
    method: 'POST',
    path: '/admin/workouts',
    body: adminWorkoutCreateSchema,
    responses: {
      400: apiErrorSchema,
      401: apiErrorSchema,
      200: adminWorkoutSchema,
    },
  },
  adminUpdateWorkout: {
    method: 'PATCH',
    path: '/admin/workouts/:workoutId',
    body: adminWorkoutUpdateSchema,
    responses: {
      400: apiErrorSchema,
      401: apiErrorSchema,
      409: apiErrorSchema,
      200: adminWorkoutSchema,
    },
  },
  adminPublishWorkout: {
    method: 'POST',
    path: '/admin/workouts/:workoutId/publish',
    body: adminWorkoutPublishSchema,
    responses: {
      400: apiErrorSchema,
      401: apiErrorSchema,
      409: apiErrorSchema,
      200: adminWorkoutSchema,
    },
  },
  adminUnpublishWorkout: {
    method: 'POST',
    path: '/admin/workouts/:workoutId/unpublish',
    body: adminWorkoutPublishSchema,
    responses: {
      400: apiErrorSchema,
      401: apiErrorSchema,
      409: apiErrorSchema,
      200: adminWorkoutSchema,
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
export type WorkoutListOrder = z.infer<typeof workoutListOrderSchema>;
export type WorkoutListQuery = z.infer<typeof workoutListQuerySchema>;
export type WorkoutListResponse = z.infer<typeof workoutListResponseSchema>;
export type AdminWorkout = z.infer<typeof adminWorkoutSchema>;
export type AdminWorkoutCreate = z.infer<typeof adminWorkoutCreateSchema>;
export type AdminWorkoutUpdate = z.infer<typeof adminWorkoutUpdateSchema>;
export type AdminWorkoutPublish = z.infer<typeof adminWorkoutPublishSchema>;
