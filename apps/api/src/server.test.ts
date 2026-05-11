import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from './server.js';
import { createMemoryUserStateStore } from './user-state-store.js';

function createAuthenticatedApp() {
  const store = createMemoryUserStateStore();
  const app = createServer({ store });

  return {
    app,
    store,
    headers: {
      'x-user-email': 'user@example.com',
      'x-user-display-name': 'Demo User',
    },
  };
}

test('GET /health returns status and timestamp', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/health',
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.status, 'ok');
  assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('POST /auth/start returns auth continuation payload', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/auth/start',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    provider: 'google',
    next: '/auth/callback',
  });
});

test('GET /users/me returns a user payload', async (t) => {
  const { app, headers } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers,
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.match(body.id, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(body, {
    id: body.id,
    email: 'user@example.com',
    displayName: 'Demo User',
  });
});

test('progress endpoints persist per-user state', async (t) => {
  const { app, headers } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const getResponse = await app.inject({
    method: 'GET',
    url: '/users/me/progress',
    headers,
  });

  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(getResponse.json(), {
    streakDays: 0,
    completedWorkouts: 0,
    lastWorkoutAt: null,
  });

  const putResponse = await app.inject({
    method: 'PUT',
    url: '/users/me/progress',
    headers,
    payload: {
      streakDays: 4,
      completedWorkouts: 16,
      lastWorkoutAt: '2026-05-09T12:00:00.000Z',
    },
  });

  assert.equal(putResponse.statusCode, 200);
  assert.deepEqual(putResponse.json(), { updated: true });

  const persistedResponse = await app.inject({
    method: 'GET',
    url: '/users/me/progress',
    headers,
  });

  assert.equal(persistedResponse.statusCode, 200);
  assert.deepEqual(persistedResponse.json(), {
    streakDays: 4,
    completedWorkouts: 16,
    lastWorkoutAt: '2026-05-09T12:00:00.000Z',
  });
});

test('preferences endpoints persist per-user state', async (t) => {
  const { app, headers } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const getResponse = await app.inject({
    method: 'GET',
    url: '/users/me/preferences',
    headers,
  });

  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(getResponse.json(), {
    units: 'metric',
    reminderTime: '07:00',
    theme: 'system',
  });

  const putResponse = await app.inject({
    method: 'PUT',
    url: '/users/me/preferences',
    headers,
    payload: {
      units: 'imperial',
      reminderTime: '08:30',
      theme: 'dark',
    },
  });

  assert.equal(putResponse.statusCode, 200);
  assert.deepEqual(putResponse.json(), { updated: true });

  const persistedResponse = await app.inject({
    method: 'GET',
    url: '/users/me/preferences',
    headers,
  });

  assert.equal(persistedResponse.statusCode, 200);
  assert.deepEqual(persistedResponse.json(), {
    units: 'imperial',
    reminderTime: '08:30',
    theme: 'dark',
  });
});

test('POST /notifications/devices upserts devices per user', async (t) => {
  const { app, headers, store } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const userResponse = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers,
  });
  const user = userResponse.json();

  const firstResponse = await app.inject({
    method: 'POST',
    url: '/notifications/devices',
    headers,
    payload: {
      platform: 'ios',
      pushToken: 'push-token-1',
    },
  });

  assert.equal(firstResponse.statusCode, 200);
  assert.deepEqual(firstResponse.json(), { registered: true });

  const secondResponse = await app.inject({
    method: 'POST',
    url: '/notifications/devices',
    headers,
    payload: {
      platform: 'android',
      pushToken: 'push-token-1',
    },
  });

  assert.equal(secondResponse.statusCode, 200);
  assert.deepEqual(secondResponse.json(), { registered: true });
  assert.deepEqual(store.listDevicesForUser(user.id), [
    {
      platform: 'android',
      pushToken: 'push-token-1',
    },
  ]);
});

test('stateful user endpoints require an authenticated user header', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/users/me/progress',
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'Unauthorized' });
});
