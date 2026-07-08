import assert from 'node:assert/strict';
import test from 'node:test';

import type { ManualWorkoutCreate, NotificationDevice, Preferences, Progress, User } from '@3plates/contract';

import {
  __resetApiTestAdapters,
  __setApiTestAdapters,
  clearSession,
  completeAuthCallback,
  createManualWorkout,
  deleteManualWorkout,
  fetchMe,
  fetchManualWorkouts,
  fetchProgress,
  fetchWorkoutsByMode,
  flushPendingMutations,
  getPendingMutationCount,
  getSessionToken,
  productionApiUrl,
  registerDevice,
  resolveApiBaseUrl,
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
    manualWorkouts: async () => ({ status: 500, body: null }),
    createManualWorkout: async () => ({ status: 500, body: null }),
    deleteManualWorkout: async () => ({ status: 500, body: null }),
    preferences: async () => ({ status: 500, body: null }),
    updatePreferences: async () => ({ status: 500, body: null }),
    registerDevice: async () => ({ status: 500, body: null }),
    workoutsByMode: async () => ({ status: 500, body: null }),
    ...overrides,
  };
}

test('API base URL defaults to production for bundled native builds', () => {
  assert.equal(resolveApiBaseUrl(undefined), productionApiUrl);
  assert.equal(resolveApiBaseUrl(''), productionApiUrl);
  assert.equal(resolveApiBaseUrl('  '), productionApiUrl);
  assert.equal(resolveApiBaseUrl('https://api.example.test'), 'https://api.example.test');
});

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

test('manual workout history uses authenticated API reads and writes', async (t) => {
  const storage = createMemoryStorage();
  let listCallCount = 0;
  let listHeaders: Record<string, string | undefined> | undefined;
  let createHeaders: Record<string, string | undefined> | undefined;
  let createBody: ManualWorkoutCreate | undefined;
  let deleteHeaders: Record<string, string | undefined> | undefined;
  let deleteParams: { workoutId: string } | undefined;
  const workout = {
    id: '1f7c40d2-4f31-4fd3-91c5-f8ef9ed6e8af',
    type: 'running_walking' as const,
    date: '2026-07-08',
    distance: '3.1 miles',
    duration: '29:42',
    wodName: '',
    workoutDetails: '',
    scale: 'scaled' as const,
    score: '',
    createdAt: '2026-07-08T12:00:00.000Z',
  };

  const client = createClientOverrides({
    manualWorkouts: async (input: { extraHeaders?: Record<string, string | undefined> }) => {
      listCallCount += 1;
      listHeaders = input.extraHeaders;
      if (listCallCount === 1) {
        return {
          status: 200,
          body: {
            workouts: [workout],
          },
        };
      }

      throw new Error('Network request failed');
    },
    createManualWorkout: async (input: {
      extraHeaders?: Record<string, string | undefined>;
      body: ManualWorkoutCreate;
    }) => {
      createHeaders = input.extraHeaders;
      createBody = input.body;
      return {
        status: 200,
        body: {
          ...input.body,
          id: '2f7c40d2-4f31-4fd3-91c5-f8ef9ed6e8af',
          createdAt: '2026-07-08T13:00:00.000Z',
        },
      };
    },
    deleteManualWorkout: async (input: {
      extraHeaders?: Record<string, string | undefined>;
      params: { workoutId: string };
    }) => {
      deleteHeaders = input.extraHeaders;
      deleteParams = input.params;
      return {
        status: 200,
        body: {
          deleted: true,
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

  await setSessionToken('token-manual-workouts');

  const first = await fetchManualWorkouts();
  assert.equal(first.source, 'network');
  assert.deepEqual(first.data.workouts, [workout]);
  assert.equal(listHeaders?.authorization, 'Bearer token-manual-workouts');

  const second = await fetchManualWorkouts();
  assert.equal(second.source, 'cache');
  assert.deepEqual(second.data.workouts, [workout]);

  const payload: ManualWorkoutCreate = {
    type: 'biking',
    date: '2026-07-09',
    distance: '12 miles',
    duration: '48:00',
    wodName: '',
    workoutDetails: '',
    scale: 'scaled',
    score: '',
  };
  const created = await createManualWorkout(payload);
  assert.equal(created.id, '2f7c40d2-4f31-4fd3-91c5-f8ef9ed6e8af');
  assert.equal(createHeaders?.authorization, 'Bearer token-manual-workouts');
  assert.deepEqual(createBody, payload);

  await deleteManualWorkout(created.id);
  assert.equal(deleteHeaders?.authorization, 'Bearer token-manual-workouts');
  assert.deepEqual(deleteParams, {
    workoutId: created.id,
  });
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

test('successful progress write clears stale queued progress writes', async (t) => {
  const storage = createMemoryStorage();
  const firstPayload = createProgress();
  const secondPayload: Progress = {
    ...firstPayload,
    lastWorkoutAt: '2026-05-11T18:30:00.000Z',
  };
  const savedPayload: Progress = {
    ...firstPayload,
    lastWorkoutAt: '2026-05-12T18:30:00.000Z',
  };
  let online = false;
  const attemptedPayloads: Progress[] = [];

  const client = createClientOverrides({
    updateProgress: async (input: { body: Progress }) => {
      attemptedPayloads.push(input.body);

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

  await setSessionToken('token-progress-clear-queue');

  const firstQueuedResult = await updateProgress(firstPayload);
  assert.equal(firstQueuedResult.queued, true);
  assert.equal(await getPendingMutationCount(), 1);

  const secondQueuedResult = await updateProgress(secondPayload);
  assert.equal(secondQueuedResult.queued, true);
  assert.equal(await getPendingMutationCount(), 1);

  online = true;

  const savedResult = await updateProgress(savedPayload);
  assert.equal(savedResult.queued, false);
  assert.equal(await getPendingMutationCount(), 0);
  assert.deepEqual(attemptedPayloads, [firstPayload, secondPayload, savedPayload]);
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
