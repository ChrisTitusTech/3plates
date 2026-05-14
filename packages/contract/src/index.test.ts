import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminWorkoutCreateSchema,
  adminWorkoutPublishSchema,
  adminWorkoutSchema,
  adminWorkoutUpdateSchema,
  appContract,
  apiErrorSchema,
  authProviderSchema,
  authSessionSchema,
  notificationDeviceSchema,
  preferencesSchema,
  progressSchema,
  workoutListQuerySchema,
  workoutListResponseSchema,
  workoutModeSchema,
  workoutSchema,
  userSchema,
} from './index.js';

test('schema validations accept valid data', () => {
  assert.equal(authProviderSchema.parse('google'), 'google');

  assert.deepEqual(
    userSchema.parse({
      id: 'user_1',
      email: 'user@example.com',
      displayName: null,
    }),
    {
      id: 'user_1',
      email: 'user@example.com',
      displayName: null,
    },
  );

  assert.deepEqual(
    progressSchema.parse({
      streakDays: 0,
      completedWorkouts: 10,
      lastWorkoutAt: null,
    }),
    {
      streakDays: 0,
      completedWorkouts: 10,
      lastWorkoutAt: null,
    },
  );

  assert.deepEqual(
    preferencesSchema.parse({
      theme: 'system',
      units: 'metric',
      reminderTime: '08:30',
    }),
    {
      theme: 'system',
      units: 'metric',
      reminderTime: '08:30',
    },
  );

  assert.deepEqual(
    notificationDeviceSchema.parse({
      platform: 'ios',
      pushToken: 'token-123',
    }),
    {
      platform: 'ios',
      pushToken: 'token-123',
    },
  );

  assert.equal(workoutModeSchema.parse('active_recovery'), 'active_recovery');

  assert.deepEqual(
    workoutSchema.parse({
      id: 'df7f8c89-8d36-4f0f-a8b9-10e4f6989db2',
      title: 'Zone 2 Bike 30',
      description: 'Easy pace for recovery',
      mode: 'active_recovery',
      isPublished: true,
    }),
    {
      id: 'df7f8c89-8d36-4f0f-a8b9-10e4f6989db2',
      title: 'Zone 2 Bike 30',
      description: 'Easy pace for recovery',
      mode: 'active_recovery',
      isPublished: true,
    },
  );

  assert.deepEqual(
    workoutListQuerySchema.parse({
      mode: 'active_recovery',
      page: '2',
      pageSize: '10',
      order: 'published_at_desc_created_at_desc_id_asc',
    }),
    {
      mode: 'active_recovery',
      page: 2,
      pageSize: 10,
      order: 'published_at_desc_created_at_desc_id_asc',
    },
  );

  assert.deepEqual(
    workoutListResponseSchema.parse({
      workouts: [
        {
          id: 'df7f8c89-8d36-4f0f-a8b9-10e4f6989db2',
          title: 'Zone 2 Bike 30',
          description: 'Easy pace for recovery',
          mode: 'active_recovery',
          isPublished: true,
        },
      ],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      ordering: {
        applied: 'published_at_desc_created_at_desc_id_asc',
      },
    }),
    {
      workouts: [
        {
          id: 'df7f8c89-8d36-4f0f-a8b9-10e4f6989db2',
          title: 'Zone 2 Bike 30',
          description: 'Easy pace for recovery',
          mode: 'active_recovery',
          isPublished: true,
        },
      ],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      ordering: {
        applied: 'published_at_desc_created_at_desc_id_asc',
      },
    },
  );

  assert.deepEqual(
    adminWorkoutCreateSchema.parse({
      title: 'Tempo Run 30',
      description: 'Threshold intervals',
      mode: 'strength_metcon',
      isPublished: false,
    }),
    {
      title: 'Tempo Run 30',
      description: 'Threshold intervals',
      mode: 'strength_metcon',
      isPublished: false,
    },
  );

  assert.deepEqual(
    adminWorkoutUpdateSchema.parse({
      expectedVersion: 2,
      title: 'Tempo Run 35',
    }),
    {
      expectedVersion: 2,
      title: 'Tempo Run 35',
    },
  );

  assert.deepEqual(
    adminWorkoutPublishSchema.parse({ expectedVersion: 3 }),
    { expectedVersion: 3 },
  );

  assert.deepEqual(
    adminWorkoutSchema.parse({
      id: 'df7f8c89-8d36-4f0f-a8b9-10e4f6989db2',
      title: 'Tempo Run 35',
      description: 'Threshold intervals',
      mode: 'strength_metcon',
      isPublished: true,
      version: 4,
      createdBy: 'api-key',
      createdAt: '2026-05-13T10:00:00.000Z',
      updatedAt: '2026-05-13T11:00:00.000Z',
      publishedAt: '2026-05-13T11:00:00.000Z',
    }),
    {
      id: 'df7f8c89-8d36-4f0f-a8b9-10e4f6989db2',
      title: 'Tempo Run 35',
      description: 'Threshold intervals',
      mode: 'strength_metcon',
      isPublished: true,
      version: 4,
      createdBy: 'api-key',
      createdAt: '2026-05-13T10:00:00.000Z',
      updatedAt: '2026-05-13T11:00:00.000Z',
      publishedAt: '2026-05-13T11:00:00.000Z',
    },
  );

  assert.deepEqual(
    authSessionSchema.parse({
      sessionToken: 'session-token-123',
      expiresAt: '2026-05-10T00:00:00.000Z',
      isNewUser: true,
      effectiveLevel: 1,
      user: {
        id: 'user_1',
        email: 'user@example.com',
        displayName: null,
      },
    }),
    {
      sessionToken: 'session-token-123',
      expiresAt: '2026-05-10T00:00:00.000Z',
      isNewUser: true,
      effectiveLevel: 1,
      user: {
        id: 'user_1',
        email: 'user@example.com',
        displayName: null,
      },
    },
  );

  assert.deepEqual(
    apiErrorSchema.parse({
      ok: false,
      error: {
        code: 'invalid_auth',
        message: 'Authentication required.',
      },
    }),
    {
      ok: false,
      error: {
        code: 'invalid_auth',
        message: 'Authentication required.',
      },
    },
  );
});

test('schema validations reject invalid data', () => {
  assert.throws(() => authProviderSchema.parse('github'));
  assert.throws(() => userSchema.parse({ id: 'user_1', email: 'not-an-email', displayName: null }));
  assert.throws(() => progressSchema.parse({ streakDays: -1, completedWorkouts: 1, lastWorkoutAt: null }));
  assert.throws(() => preferencesSchema.parse({ theme: 'light', units: 'metric', reminderTime: '8:30' }));
  assert.throws(() => notificationDeviceSchema.parse({ platform: 'desktop', pushToken: 'token-123' }));
  assert.throws(() => workoutModeSchema.parse('hyrox'));
  assert.throws(() => workoutListQuerySchema.parse({ mode: 'active_recovery', page: 0 }));
  assert.throws(() => workoutListQuerySchema.parse({ mode: 'active_recovery', pageSize: 100 }));
  assert.throws(() => adminWorkoutUpdateSchema.parse({ expectedVersion: 1 }));
  assert.throws(() => adminWorkoutPublishSchema.parse({ expectedVersion: 0 }));
  assert.throws(() =>
    workoutSchema.parse({
      id: 'not-a-uuid',
      title: 'Bad workout',
      description: null,
      mode: 'active_recovery',
      isPublished: true,
    }),
  );
});

test('contract routes expose expected endpoint paths', () => {
  assert.equal(appContract.health.path, '/health');
  assert.equal(appContract.authStart.path, '/auth/start');
  assert.equal(appContract.authLinkStart.path, '/auth/link');
  assert.equal(appContract.authCallback.path, '/auth/callback');
  assert.equal(appContract.authRefresh.path, '/auth/refresh');
  assert.equal(appContract.me.path, '/users/me');
  assert.equal(appContract.progress.path, '/users/me/progress');
  assert.equal(appContract.updateProgress.path, '/users/me/progress');
  assert.equal(appContract.preferences.path, '/users/me/preferences');
  assert.equal(appContract.updatePreferences.path, '/users/me/preferences');
  assert.equal(appContract.registerDevice.path, '/notifications/devices');
  assert.equal(appContract.workoutsByMode.path, '/workouts');
  assert.equal(appContract.adminCreateWorkout.path, '/admin/workouts');
  assert.equal(appContract.adminUpdateWorkout.path, '/admin/workouts/:workoutId');
  assert.equal(appContract.adminPublishWorkout.path, '/admin/workouts/:workoutId/publish');
  assert.equal(appContract.adminUnpublishWorkout.path, '/admin/workouts/:workoutId/unpublish');
});
