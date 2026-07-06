import assert from 'node:assert/strict';
import test from 'node:test';

import type { NotificationDevice, Preferences, Progress, User } from '@3plates/contract';

import {
  __resetApiTestAdapters,
  __setApiTestAdapters,
  clearSession,
  completeAuthCallback,
  fetchMe,
  fetchProgress,
  fetchWorkoutsByMode,
  flushPendingMutations,
  getPendingMutationCount,
  getSessionToken,
  registerDevice,
  setSessionToken,
  signOutAndClearSession,
  updateProgress,
  updatePreferences,
} from './api';

function createMemoryStorage() {
  const values = new Map<string, string>();

  return {
    async getItem(key: string) {
      return values.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      values.set(key, value);
    },
    async removeItem(key: string) {
      values.delete(key);
    },
  };
}

function createBaseUser(): User {
  return {
    id: 'user-1',
    email: 'tester@example.com',
    displayName: 'Tester',
  };
}

function createProgress(): Progress {
  return {
    streakDays: 4,
    completedWorkouts: 11,
    lastWorkoutAt: '2026-05-10T18:30:00.000Z',
  };
}

function createClientOverrides(overrides: Record<string, unknown>) {
  return {
    authStart: async () => ({ status: 500, body: null }),
    authCallback: async () => ({ status: 500, body: null }),
    authExchange: async () => ({ status: 500, body: null }),
    authRefresh: async () => ({ status: 500, body: null }),
    authSignOut: async () => ({ status: 500, body: null }),
    me: async () => ({ status: 500, body: null }),
    progress: async () => ({ status: 500, body: null }),
    updateProgress: async () => ({ status: 500, body: null }),
    preferences: async () => ({ status: 500, body: null }),
    updatePreferences: async () => ({ status: 500, body: null }),
    registerDevice: async () => ({ status: 500, body: null }),
    workoutsByMode: async () => ({ status: 500, body: null }),
    ...overrides,
  };
}

test('auth callback persists token and subsequent me request sends bearer token', async (t) => {
  const storage = createMemoryStorage();
  const user = createBaseUser();
  let meHeaders: Record<string, string | undefined> | undefined;

  const client = createClientOverrides({
    authCallback: async () => ({
      status: 200,
      body: {
        ok: true,
        provider: 'google',
        redirectTo: null,
        sessionToken: 'session-token-1',
        expiresAt: '2026-05-12T00:00:00.000Z',
        user,
      },
    }),
    me: async (input: { extraHeaders?: Record<string, string | undefined> }) => {
      meHeaders = input.extraHeaders;
      return {
        status: 200,
        body: user,
      };
    },
  });

  __setApiTestAdapters({
    storage,
    client: client as never,
  });

  t.after(() => {
    __resetApiTestAdapters();
  });

  await completeAuthCallback({
    provider: 'google',
    code: 'demo-code',
    state: 'demo-state',
  });

  const token = await getSessionToken();
  assert.equal(token, 'session-token-1');

  const me = await fetchMe();
  assert.equal(me.source, 'network');
  assert.deepEqual(me.data, user);
  assert.equal(meHeaders?.authorization, 'Bearer session-token-1');
});

test('progress read falls back to cached value on network failure', async (t) => {
  const storage = createMemoryStorage();
  let callCount = 0;
  const networkProgress = createProgress();

  const client = createClientOverrides({
    progress: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          status: 200,
          body: networkProgress,
        };
      }

      throw new Error('Network request failed');
    },
  });

  __setApiTestAdapters({
    storage,
    client: client as never,
  });

  t.after(() => {
    __resetApiTestAdapters();
  });

  await setSessionToken('token-progress');

  const first = await fetchProgress();
  assert.equal(first.source, 'network');
  assert.deepEqual(first.data, networkProgress);

  const second = await fetchProgress();
  assert.equal(second.source, 'cache');
  assert.deepEqual(second.data, networkProgress);
});

test('queued progress write is retried and flushed once network recovers', async (t) => {
  const storage = createMemoryStorage();
  const payload = createProgress();
  let online = false;
  let updateCalls = 0;

  const client = createClientOverrides({
    updateProgress: async (input: { body: Progress }) => {
      updateCalls += 1;
      assert.deepEqual(input.body, payload);

      if (!online) {
        throw new Error('Network request failed');
      }

      return {
        status: 200,
        body: {
          updated: true,
        },
      };
    },
  });

  __setApiTestAdapters({
    storage,
    client: client as never,
  });

  t.after(() => {
    __resetApiTestAdapters();
  });

  await setSessionToken('token-progress-queue');

  const queuedResult = await updateProgress(payload);
  assert.equal(queuedResult.queued, true);
  assert.equal(await getPendingMutationCount(), 1);

  online = true;

  const flushResult = await flushPendingMutations();
  assert.equal(flushResult.flushed, 1);
  assert.equal(flushResult.remaining, 0);
  assert.equal(await getPendingMutationCount(), 0);
  assert.equal(updateCalls, 2);
});

test('queued preferences write is retried and flushed once network recovers', async (t) => {
  const storage = createMemoryStorage();
  const payload: Preferences = {
    theme: 'dark',
    units: 'imperial',
    reminderTime: '06:45',
  };
  let online = false;
  let updateCalls = 0;

  const client = createClientOverrides({
    updatePreferences: async (input: { body: Preferences }) => {
      updateCalls += 1;
      assert.deepEqual(input.body, payload);

      if (!online) {
        throw new Error('Network request failed');
      }

      return {
        status: 200,
        body: {
          updated: true,
        },
      };
    },
  });

  __setApiTestAdapters({
    storage,
    client: client as never,
  });

  t.after(() => {
    __resetApiTestAdapters();
  });

  await setSessionToken('token-preferences-queue');

  const queuedResult = await updatePreferences(payload);
  assert.equal(queuedResult.queued, true);
  assert.equal(await getPendingMutationCount(), 1);

  online = true;

  const flushResult = await flushPendingMutations();
  assert.equal(flushResult.flushed, 1);
  assert.equal(flushResult.remaining, 0);
  assert.equal(await getPendingMutationCount(), 0);
  assert.equal(updateCalls, 2);
});

test('queued notification device registration flushes when online again', async (t) => {
  const storage = createMemoryStorage();
  const payload: NotificationDevice = {
    platform: 'ios',
    pushToken: 'ExponentPushToken[test-token]',
  };
  let online = false;
  let registerCalls = 0;

  const client = createClientOverrides({
    registerDevice: async (input: { body: NotificationDevice }) => {
      registerCalls += 1;
      assert.deepEqual(input.body, payload);

      if (!online) {
        throw new Error('Network request failed');
      }

      return {
        status: 200,
        body: {
          registered: true,
        },
      };
    },
  });

  __setApiTestAdapters({
    storage,
    client: client as never,
  });

  t.after(() => {
    __resetApiTestAdapters();
  });

  await setSessionToken('token-device-queue');

  const queuedResult = await registerDevice(payload);
  assert.equal(queuedResult.queued, true);
  assert.equal(await getPendingMutationCount(), 1);

  online = true;

  const flushResult = await flushPendingMutations();
  assert.equal(flushResult.flushed, 1);
  assert.equal(flushResult.remaining, 0);
  assert.equal(await getPendingMutationCount(), 0);
  assert.equal(registerCalls, 2);

  await clearSession();
  assert.equal(await getSessionToken(), null);
});

test('sign out revokes backend session and clears local queued state', async (t) => {
  const storage = createMemoryStorage();
  let signOutHeaders: Record<string, string | undefined> | undefined;

  const client = createClientOverrides({
    registerDevice: async () => {
      throw new Error('Network request failed');
    },
    authSignOut: async (input: { extraHeaders?: Record<string, string | undefined> }) => {
      signOutHeaders = input.extraHeaders;
      return {
        status: 200,
        body: {
          signedOut: true,
        },
      };
    },
  });

  __setApiTestAdapters({
    storage,
    client: client as never,
  });

  t.after(() => {
    __resetApiTestAdapters();
  });

  await setSessionToken('token-sign-out');
  await registerDevice({
    platform: 'ios',
    pushToken: 'ExponentPushToken[pending-before-sign-out]',
  });
  assert.equal(await getPendingMutationCount(), 1);

  const result = await signOutAndClearSession();
  assert.equal(result.signedOut, true);
  assert.equal(signOutHeaders?.authorization, 'Bearer token-sign-out');
  assert.equal(await getSessionToken(), null);
  assert.equal(await getPendingMutationCount(), 0);
});

test('sign out clears local session when backend token is already invalid', async (t) => {
  const storage = createMemoryStorage();

  const client = createClientOverrides({
    authSignOut: async () => ({
      status: 401,
      body: {
        ok: false,
        error: {
          code: 'invalid_auth',
          message: 'Authentication required.',
        },
      },
    }),
  });

  __setApiTestAdapters({
    storage,
    client: client as never,
  });

  t.after(() => {
    __resetApiTestAdapters();
  });

  await setSessionToken('stale-token-sign-out');

  const result = await signOutAndClearSession();
  assert.equal(result.signedOut, false);
  assert.equal(await getSessionToken(), null);
});

test('workout mode read sends pagination query and falls back to cached value', async (t) => {
  const storage = createMemoryStorage();
  let callCount = 0;
  const requestedQueries: unknown[] = [];
  const workouts = [
    {
      id: '1f7c40d2-4f31-4fd3-91c5-f8ef9ed6e8af',
      title: 'Bike Recovery 30',
      description: 'Zone 2 spin',
      mode: 'active_recovery' as const,
      isPublished: true,
    },
  ];
  const responseBody = {
    workouts,
    pagination: {
      page: 2,
      pageSize: 5,
      total: 6,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    },
    ordering: {
      applied: 'published_at_desc_created_at_desc_id_asc' as const,
    },
  };

  const client = createClientOverrides({
    workoutsByMode: async (input: { query: unknown }) => {
      callCount += 1;
      requestedQueries.push(input.query);
      if (callCount === 1) {
        return {
          status: 200,
          body: responseBody,
        };
      }

      throw new Error('Network request failed');
    },
  });

  __setApiTestAdapters({
    storage,
    client: client as never,
  });

  t.after(() => {
    __resetApiTestAdapters();
  });

  await setSessionToken('token-workouts');

  const first = await fetchWorkoutsByMode('active_recovery', { page: 2, pageSize: 5 });
  assert.equal(first.source, 'network');
  assert.deepEqual(first.data, responseBody);
  assert.deepEqual(requestedQueries[0], {
    mode: 'active_recovery',
    page: 2,
    pageSize: 5,
    order: 'published_at_desc_created_at_desc_id_asc',
  });

  const second = await fetchWorkoutsByMode('active_recovery', { page: 2, pageSize: 5 });
  assert.equal(second.source, 'cache');
  assert.deepEqual(second.data, responseBody);
});
