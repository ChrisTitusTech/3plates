import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { env } from './env.js';
import { createServer } from './server.js';
import { createDbUserStateStore } from './user-state-store.js';

const repoRootDirectory = new URL('../../../', import.meta.url).pathname;

async function withDbApp<T>(run: (context: {
  app: ReturnType<typeof createServer>;
  headers: Record<string, string>;
}) => Promise<T>) {
  execSync('pnpm db:setup', { cwd: repoRootDirectory, stdio: 'inherit' });

  const store = createDbUserStateStore(env.DATABASE_URL ?? '');
  const app = createServer({ store });
  const headers = {
    'x-user-email': `integration-${randomUUID()}@example.com`,
    'x-user-display-name': 'Integration Test',
  };

  try {
    return await run({ app, headers });
  } finally {
    await app.close();
    await store.close?.();
  }
}

test('DB-backed progress endpoints persist through Postgres', async () => {
  await withDbApp(async ({ app, headers }) => {
    const initialResponse = await app.inject({
      method: 'GET',
      url: '/users/me/progress',
      headers,
    });

    assert.equal(initialResponse.statusCode, 200);
    assert.deepEqual(initialResponse.json(), {
      streakDays: 0,
      completedWorkouts: 0,
      lastWorkoutAt: null,
    });

    const writeResponse = await app.inject({
      method: 'PUT',
      url: '/users/me/progress',
      headers,
      payload: {
        streakDays: 9,
        completedWorkouts: 27,
        lastWorkoutAt: '2026-05-10T12:34:56.000Z',
      },
    });

    assert.equal(writeResponse.statusCode, 200);
    assert.deepEqual(writeResponse.json(), { updated: true });

    const persistedResponse = await app.inject({
      method: 'GET',
      url: '/users/me/progress',
      headers,
    });

    assert.equal(persistedResponse.statusCode, 200);
    assert.deepEqual(persistedResponse.json(), {
      streakDays: 9,
      completedWorkouts: 27,
      lastWorkoutAt: '2026-05-10T12:34:56.000Z',
    });
  });
});

test('DB-backed preferences and devices persist through Postgres', async () => {
  await withDbApp(async ({ app, headers }) => {
    const preferencesResponse = await app.inject({
      method: 'PUT',
      url: '/users/me/preferences',
      headers,
      payload: {
        theme: 'dark',
        units: 'imperial',
        reminderTime: '06:45',
      },
    });

    assert.equal(preferencesResponse.statusCode, 200);
    assert.deepEqual(preferencesResponse.json(), { updated: true });

    const persistedPreferences = await app.inject({
      method: 'GET',
      url: '/users/me/preferences',
      headers,
    });

    assert.equal(persistedPreferences.statusCode, 200);
    assert.deepEqual(persistedPreferences.json(), {
      theme: 'dark',
      units: 'imperial',
      reminderTime: '06:45',
    });

    const firstDeviceResponse = await app.inject({
      method: 'POST',
      url: '/notifications/devices',
      headers,
      payload: {
        platform: 'web',
        pushToken: `push-token-${randomUUID()}`,
      },
    });

    assert.equal(firstDeviceResponse.statusCode, 200);
    assert.deepEqual(firstDeviceResponse.json(), { registered: true });

    const secondDeviceResponse = await app.inject({
      method: 'POST',
      url: '/notifications/devices',
      headers,
      payload: {
        platform: 'android',
        pushToken: 'push-token-shared',
      },
    });

    assert.equal(secondDeviceResponse.statusCode, 200);
    assert.deepEqual(secondDeviceResponse.json(), { registered: true });

    const updatedDeviceResponse = await app.inject({
      method: 'POST',
      url: '/notifications/devices',
      headers,
      payload: {
        platform: 'ios',
        pushToken: 'push-token-shared',
      },
    });

    assert.equal(updatedDeviceResponse.statusCode, 200);
    assert.deepEqual(updatedDeviceResponse.json(), { registered: true });

    const userResponse = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers,
    });
    const user = userResponse.json();

    const persistedUserResponse = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers,
    });

    assert.equal(persistedUserResponse.statusCode, 200);
    assert.equal(persistedUserResponse.json().id, user.id);
    assert.equal(persistedUserResponse.json().email, headers['x-user-email']);
  });
});