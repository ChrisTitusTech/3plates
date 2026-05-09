import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from './server.js';

test('GET /health returns status and timestamp', async (t) => {
  const app = createServer();
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
  const app = createServer();
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
  const app = createServer();
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/users/me',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    id: 'user_123',
    email: 'user@example.com',
    displayName: 'Demo User',
  });
});

test('progress endpoints return expected shapes', async (t) => {
  const app = createServer();
  t.after(async () => {
    await app.close();
  });

  const getResponse = await app.inject({
    method: 'GET',
    url: '/users/me/progress',
  });

  assert.equal(getResponse.statusCode, 200);
  const progress = getResponse.json();
  assert.equal(progress.streakDays, 3);
  assert.equal(progress.completedWorkouts, 12);
  assert.match(progress.lastWorkoutAt, /^\d{4}-\d{2}-\d{2}T/);

  const putResponse = await app.inject({
    method: 'PUT',
    url: '/users/me/progress',
  });

  assert.equal(putResponse.statusCode, 200);
  assert.deepEqual(putResponse.json(), { updated: true });
});

test('preferences endpoints return expected payloads', async (t) => {
  const app = createServer();
  t.after(async () => {
    await app.close();
  });

  const getResponse = await app.inject({
    method: 'GET',
    url: '/users/me/preferences',
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
  });

  assert.equal(putResponse.statusCode, 200);
  assert.deepEqual(putResponse.json(), { updated: true });
});

test('POST /notifications/devices confirms registration', async (t) => {
  const app = createServer();
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/notifications/devices',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { registered: true });
});
