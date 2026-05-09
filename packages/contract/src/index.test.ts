import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appContract,
  authProviderSchema,
  notificationDeviceSchema,
  preferencesSchema,
  progressSchema,
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
});

test('schema validations reject invalid data', () => {
  assert.throws(() => authProviderSchema.parse('github'));
  assert.throws(() => userSchema.parse({ id: 'user_1', email: 'not-an-email', displayName: null }));
  assert.throws(() => progressSchema.parse({ streakDays: -1, completedWorkouts: 1, lastWorkoutAt: null }));
  assert.throws(() => preferencesSchema.parse({ theme: 'light', units: 'metric', reminderTime: '8:30' }));
  assert.throws(() => notificationDeviceSchema.parse({ platform: 'desktop', pushToken: 'token-123' }));
});

test('contract routes expose expected endpoint paths', () => {
  assert.equal(appContract.health.path, '/health');
  assert.equal(appContract.authStart.path, '/auth/start');
  assert.equal(appContract.me.path, '/users/me');
  assert.equal(appContract.progress.path, '/users/me/progress');
  assert.equal(appContract.updateProgress.path, '/users/me/progress');
  assert.equal(appContract.preferences.path, '/users/me/preferences');
  assert.equal(appContract.updatePreferences.path, '/users/me/preferences');
  assert.equal(appContract.registerDevice.path, '/notifications/devices');
});
