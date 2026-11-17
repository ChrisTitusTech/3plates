import assert from 'node:assert/strict';
import test from 'node:test';

import type { ManualWorkoutCreate, NotificationDevice, Preferences, Progress, User } from '@3plates/contract';

import {
  ApiRequestError,
  startAuth,
  startAuthLink,
  redeemMobileAuthExchangeCode,
  __resetApiTestAdapters,
  __setApiTestAdapters,
  clearSession,
  expireSession,
  createManualWorkout,
  deleteManualWorkout,
  fetchMe,
  fetchPreferences,
  fetchManualWorkouts,
  fetchProgress,
  fetchWorkoutsByMode,
  flushPendingMutations,
  getPendingMutationCount,
  getSessionToken,
  getSessionGeneration,
  registerSignOutCleanup,
  getCachedUser,
  productionApiUrl,
  refreshSessionAndPersist,
  registerDevice,
  resolveApiBaseUrl,
  setSessionToken,
  subscribePreferences,
  syncPendingPreferences,
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

test('auth exchange persists token and subsequent me request sends bearer token', async (t) => {
  const storage = createMemoryStorage();
  const user = createBaseUser();
  let meHeaders: Record<string, string | undefined> | undefined;

  const client = createClientOverrides({
    authStart: async () => ({ status: 200, body: { state: 'demo-state' } }),
    authExchange: async () => ({
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

  await startAuth('google', 'threeplates://auth/callback');
  await redeemMobileAuthExchangeCode('demo-code', 'demo-state');

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

test('account caches stay separate and a late response cannot overwrite the active account', async (t) => {
  const storage = createMemoryStorage();
  let activeUser = createBaseUser();
  let offline = false;
  let completeRead: ((value: unknown) => void) | undefined;
  const client = createClientOverrides({
    me: async () => ({ status: 200, body: activeUser }),
    progress: async () => {
      if (offline) throw new Error('Network request failed');
      return { status: 200, body: createProgress() };
    },
  });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('alice-token'); await fetchMe(); await fetchProgress();
  activeUser = { ...activeUser, id: 'bob', email: 'bob@example.test' };
  await setSessionToken('bob-token'); await fetchMe(); offline = true;
  await assert.rejects(fetchProgress(), /Network request failed/);
  client.me = () => new Promise((resolve) => { completeRead = resolve; }) as never;
  const late = fetchMe();
  // Allow the mocked request to start before switching sessions.
  while (!completeRead) await new Promise((resolve) => setImmediate(resolve));
  await setSessionToken('charlie-token');
  completeRead({ status: 200, body: { ...activeUser, id: 'stale-bob' } });
  await assert.rejects(late, /active account changed/);
  assert.equal(JSON.parse((await storage.getItem('@3plates/cache/me'))!).value.id, 'bob');
});

test('upgrading moves legacy offline changes into their original account before an account switch', async (t) => {
  const storage = createMemoryStorage(); const alice = createBaseUser(); const bob = { ...alice, id: 'bob' };
  await storage.setItem('@3plates/cache/me', JSON.stringify({ value: alice, updatedAt: new Date().toISOString() }));
  await storage.setItem('@3plates/pending-mutations', JSON.stringify([{ id: 'old-progress', type: 'updateProgress', createdAt: new Date().toISOString(), payload: createProgress() }]));
  await storage.setItem('@3plates/cache/progress', JSON.stringify({ value: createProgress(), updatedAt: new Date().toISOString() }));
  let owner = bob; let writes = 0;
  const client = createClientOverrides({ me: async () => ({ status: 200, body: owner }), updateProgress: async () => { writes++; return { status: 200, body: createProgress() }; } });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('bob-token'); await fetchMe();
  assert.equal(await getPendingMutationCount(), 0); assert.equal(writes, 0);
  assert.equal(await storage.getItem('@3plates/pending-mutations'), null);
  assert.equal(JSON.parse((await storage.getItem(`@3plates/pending-mutations/user/${alice.id}`))!).length, 1);
  owner = alice; await setSessionToken('alice-token'); await fetchMe();
  assert.equal(await getPendingMutationCount(), 1);
  const flushed = await flushPendingMutations(); assert.equal(flushed.flushed, 1); assert.equal(writes, 1);
});

test('temporary API outages permit cached account access but invalid sessions never do', async (t) => {
  const storage = createMemoryStorage(); const user = createBaseUser(); let status = 200;
  const client = createClientOverrides({ me: async () => ({ status, body: status === 200 ? user : null }) });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('cached-account-token'); await fetchMe();
  for (status of [502, 503, 429]) assert.deepEqual(await fetchMe(), { data: user, source: 'cache' });
  status = 401; await assert.rejects(fetchMe(), (error: unknown) => (error as { status: number }).status === 401);
  status = 404; await assert.rejects(fetchMe(), (error: unknown) => (error as { status: number }).status === 404);
});

test('temporary API outages preserve cached measurement preferences', async (t) => {
  const storage = createMemoryStorage(); const user = createBaseUser(); let status = 200;
  const preferences = { theme: 'system', units: 'imperial', reminderTime: '07:00' };
  const client = createClientOverrides({ me: async () => ({ status: 200, body: user }),
    preferences: async () => ({ status, body: status === 200 ? preferences : null }) });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('cached-preferences-token'); await fetchMe(); await fetchPreferences();
  for (status of [502, 503, 429]) assert.deepEqual(await fetchPreferences(), { data: preferences, source: 'cache' });
  status = 401; await assert.rejects(fetchPreferences(), (error: unknown) => (error as { status: number }).status === 401);
});

test('queued appearance remains authoritative through outages and updates subscribers', async (t) => {
  const storage = createMemoryStorage(); const user = createBaseUser(); let status = 503;
  let saved: Preferences = { theme: 'system', units: 'imperial', reminderTime: '08:30' };
  const changes: Preferences[] = [];
  const client = createClientOverrides({ me: async () => ({ status: 200, body: user }),
    preferences: async () => ({ status: 200, body: saved }),
    updatePreferences: async ({ body }: { body: Preferences }) => { if (status === 200) saved = body; return { status, body: status === 200 ? body : null }; } });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  t.after(subscribePreferences((value) => changes.push(value)));
  await setSessionToken('theme-test-token'); await fetchMe(); await fetchPreferences();
  const dark = { ...saved, theme: 'dark' as const };
  assert.deepEqual(await updatePreferences(dark), { queued: true });
  assert.deepEqual(changes, [dark]);
  assert.deepEqual(await fetchPreferences(), { data: dark, source: 'cache' });
  await syncPendingPreferences(); assert.equal(await getPendingMutationCount(), 1);
  assert.deepEqual(await fetchPreferences(), { data: dark, source: 'cache' });
  status = 200; await syncPendingPreferences(); assert.equal(await getPendingMutationCount(), 0);
  assert.deepEqual(await fetchPreferences(), { data: dark, source: 'network' });
});

test('a delayed preference read cannot replace a newly saved appearance', async (t) => {
  const storage = createMemoryStorage(); const user = createBaseUser();
  const initial: Preferences = { theme: 'light', units: 'metric', reminderTime: '07:00' };
  let release!: () => void; let started!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  let delay = false;
  const client = createClientOverrides({ me: async () => ({ status: 200, body: user }),
    preferences: async () => { if (delay) { started(); await waiting; } return { status: 200, body: initial }; },
    updatePreferences: async ({ body }: { body: Preferences }) => ({ status: 200, body }) });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('theme-read-race'); await fetchMe(); await fetchPreferences();
  delay = true; const stale = fetchPreferences(); await requested;
  const dark = { ...initial, theme: 'dark' as const }; await updatePreferences(dark); release();
  assert.deepEqual(await stale, { data: dark, source: 'cache' });
});

test('a new session cannot use a previous token-bound profile during an outage', async (t) => {
  const storage = createMemoryStorage(); let status = 200;
  const client = createClientOverrides({ me: async () => ({ status, body: status === 200 ? createBaseUser() : null }) });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('alice'); await fetchMe();
  await setSessionToken('bob');
  assert.equal(await getCachedUser(), null);
  for (status of [503, 429]) await assert.rejects(fetchMe());
  await setSessionToken('alice');
  assert.equal((await fetchMe()).data.id, createBaseUser().id);
});

test('a late progress response cannot remove the newly active account queue', async (t) => {
  const storage = createMemoryStorage(); let user = createBaseUser();
  let release!: () => void; let entered!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let delay = true;
  const client = createClientOverrides({ me: async () => ({ status: 200, body: user }),
    updateProgress: async () => { if (delay) { entered(); await wait; return { status: 200, body: createProgress() }; } throw new Error('Network request failed'); } });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('alice'); await fetchMe();
  const late = updateProgress(createProgress()); await started;
  user = { ...user, id: 'bob' }; await setSessionToken('bob'); await fetchMe(); delay = false;
  await updateProgress(createProgress());
  release(); await assert.rejects(late, /active account changed/);
  assert.equal(await getPendingMutationCount(), 1);
});

test('a preference queued during a flush remains pending after that flush', async (t) => {
  const storage = createMemoryStorage(); let flushing = false;
  let release!: () => void; let entered!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const client = createClientOverrides({ me: async () => ({ status: 200, body: createBaseUser() }),
    updateProgress: async () => { if (!flushing) throw new Error('Network request failed'); entered(); await wait; return { status: 200, body: createProgress() }; },
    updatePreferences: async () => ({ status: 503, body: null }) });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('flush-race'); await fetchMe(); await updateProgress(createProgress());
  flushing = true; const flush = flushPendingMutations(); await started;
  const preference = updatePreferences({ theme: 'dark', units: 'metric', reminderTime: '08:00' });
  await new Promise((resolve) => setImmediate(resolve));
  release(); await flush; await preference;
  const queue = JSON.parse((await storage.getItem('@3plates/pending-mutations/user/user-1'))!);
  assert.equal(queue.length, 1); assert.equal(queue[0].type, 'updatePreferences'); assert.equal(queue[0].payload.theme, 'dark');
});

test('generic retry retains preference mutations on 429 and 5xx responses', async (t) => {
  const storage = createMemoryStorage(); let status = 503;
  const client = createClientOverrides({ me: async () => ({ status: 200, body: createBaseUser() }), updatePreferences: async () => ({ status, body: null }) });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('retry-preferences'); await fetchMe();
  await updatePreferences({ theme: 'dark', units: 'metric', reminderTime: '07:00' });
  for (status of [503, 429]) { await flushPendingMutations(); assert.equal(await getPendingMutationCount(), 1); }
});

test('a read begun during a preference write cannot overwrite the completed write', async (t) => {
  const storage = createMemoryStorage(); const initial: Preferences = { theme: 'light', units: 'metric', reminderTime: '07:00' };
  let finishWrite!: () => void; let beginWrite!: () => void; let finishRead!: () => void; let beginRead!: () => void;
  const writing = new Promise<void>((resolve) => { beginWrite = resolve; });
  const writeWait = new Promise<void>((resolve) => { finishWrite = resolve; });
  const reading = new Promise<void>((resolve) => { beginRead = resolve; });
  const readWait = new Promise<void>((resolve) => { finishRead = resolve; });
  const client = createClientOverrides({ me: async () => ({ status: 200, body: createBaseUser() }),
    preferences: async () => { beginRead(); await readWait; return { status: 200, body: initial }; },
    updatePreferences: async ({ body }: { body: Preferences }) => { beginWrite(); await writeWait; return { status: 200, body }; } });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('write-then-read'); await fetchMe();
  const dark = { ...initial, theme: 'dark' as const }; const write = updatePreferences(dark); await writing;
  const stale = fetchPreferences(); await reading; finishWrite(); await write; finishRead();
  assert.deepEqual(await stale, { data: dark, source: 'cache' });
});

test('successful sign-in repairs malformed profiles while preserving unidentified offline data', async (t) => {
  t.after(__resetApiTestAdapters);
  for (const raw of ['{broken', 'null', '{}']) {
    const storage = createMemoryStorage();
    await storage.setItem('@3plates/cache/me', raw);
    await storage.setItem('@3plates/pending-mutations', JSON.stringify([{ id: 'orphan', type: 'updateProgress', payload: createProgress() }]));
    __setApiTestAdapters({ storage, client: createClientOverrides({ me: async () => ({ status: 200, body: createBaseUser() }) }) as never });
    await setSessionToken('recovered-session');
    assert.equal(await getSessionToken(), 'recovered-session');
    assert.equal((await fetchMe()).data.id, createBaseUser().id);
    assert.equal(await getPendingMutationCount(), 0);
    assert.equal(JSON.parse((await storage.getItem('@3plates/pending-mutations/user/unverified'))!)[0].id, 'orphan');
  }
});

test('enqueue and flush keep their original queue key when the session switches after the last token check', async (t) => {
  t.after(__resetApiTestAdapters);
  const { createHash } = await import('node:crypto');
  for (const operation of ['enqueue', 'flush']) {
    const backing = createMemoryStorage();
    const aliceKey = '@3plates/pending-mutations/user/user-1';
    const bobKey = '@3plates/pending-mutations/user/bob';
    let armed = false; let switchOnCheck = false;
    const storage = { ...backing, async getItem(key: string) {
      const value = await backing.getItem(key);
      if (armed && key === aliceKey && operation === 'enqueue') switchOnCheck = true;
      if (switchOnCheck && key === '@3plates/session-token') {
        armed = false; switchOnCheck = false;
        await backing.setItem('@3plates/session-token', 'bob');
        await backing.setItem('@3plates/cache/me', JSON.stringify({ value: { ...createBaseUser(), id: 'bob' }, sessionHash: createHash('sha256').update('bob').digest('hex') }));
      }
      return value;
    } };
    const client = createClientOverrides({ me: async () => ({ status: 200, body: createBaseUser() }),
      registerDevice: async () => { if (operation === 'flush') { switchOnCheck = true; await storage.getItem('@3plates/session-token'); } throw new Error('Network request failed'); } });
    __setApiTestAdapters({ storage, client: client as never });
    await setSessionToken('alice'); await fetchMe(); await getPendingMutationCount();
    const device: NotificationDevice = { platform: 'ios', pushToken: 'alice-push-token' };
    const queued = { id: 'alice-change', type: 'registerDevice', payload: device, createdAt: new Date().toISOString() };
    const bobQueue = JSON.stringify([{ ...queued, id: 'bob-change', payload: { ...device, pushToken: 'bob-push-token' } }]);
    await backing.setItem(bobKey, bobQueue);
    armed = true;
    if (operation === 'flush') { await backing.setItem(aliceKey, JSON.stringify([queued])); await assert.rejects(flushPendingMutations(), /Network request failed/); }
    else await registerDevice(device);
    assert.equal(await getSessionToken(), 'bob');
    assert.equal(await backing.getItem(bobKey), bobQueue);
    const aliceQueue = JSON.parse((await backing.getItem(aliceKey))!);
    assert.equal(aliceQueue.length, 1); assert.equal(aliceQueue[0].payload.pushToken, 'alice-push-token');
  }
});


test('sign-out cannot clear a session established during cleanup or the backend request', async (t) => {
  t.after(__resetApiTestAdapters);
  t.after(() => registerSignOutCleanup(async () => undefined));
  for (const phase of ['before-discard', 'cleanup', 'request']) {
    const storage = createMemoryStorage(); let activeUser = createBaseUser(); let requests = 0;
    const switchAccount = async () => { activeUser = { ...activeUser, id: 'bob' }; await setSessionToken('bob'); await fetchMe(); };
    const client = createClientOverrides({ me: async () => ({ status: 200, body: activeUser }),
      authSignOut: async (input: { extraHeaders: { authorization: string } }) => {
        requests++; assert.equal(input.extraHeaders.authorization, 'Bearer alice');
        if (phase === 'request') await switchAccount();
        return { status: 200, body: { signedOut: true } };
      } });
    __setApiTestAdapters({ storage, client: client as never });
    registerSignOutCleanup(async (owner) => { assert.equal(owner?.id, 'user-1'); if (phase === 'cleanup') await switchAccount(); });
    await setSessionToken('alice'); await fetchMe(); const generation = getSessionGeneration();
    if (phase === 'before-discard') await switchAccount();
    await assert.rejects(signOutAndClearSession(generation), /active account changed/);
    assert.equal(await getSessionToken(), 'bob'); assert.equal((await getCachedUser())?.id, 'bob');
    assert.equal(requests, phase === 'request' ? 1 : 0);
  }
});

test('a new sign-in waits for old local session cleanup to finish', async (t) => {
  const backing = createMemoryStorage(); let release!: () => void; let entered!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let armed = false;
  const storage = { ...backing, async removeItem(key: string) {
    if (armed && key === '@3plates/cache/me') { entered(); await waiting; }
    await backing.removeItem(key);
  } };
  __setApiTestAdapters({ storage, client: createClientOverrides({ me: async () => ({ status: 200, body: createBaseUser() }) }) as never });
  t.after(__resetApiTestAdapters);
  await setSessionToken('alice'); await fetchMe(); armed = true;
  const clear = clearSession(); await started;
  const signIn = setSessionToken('bob').then(() => fetchMe());
  release(); await clear; await signIn;
  assert.equal(await getSessionToken(), 'bob'); assert.equal((await getCachedUser())?.id, 'user-1');
});

test('session expiry preserves account-owned offline changes for same-account reauthentication', async (t) => {
  const storage = createMemoryStorage(); const alice = createBaseUser(); let owner = alice; let offline = true;
  let writes = 0;
  const preferences: Preferences = { theme: 'dark', units: 'imperial', reminderTime: '08:00' };
  const client = createClientOverrides({ me: async () => ({ status: 200, body: owner }),
    updateProgress: async () => { if (offline) throw new Error('Network request failed'); writes++; return { status: 200, body: createProgress() }; },
    updatePreferences: async () => { if (offline) return { status: 503, body: null }; writes++; return { status: 200, body: preferences }; } });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('alice-before-expiry'); await fetchMe();
  await updateProgress(createProgress()); await updatePreferences(preferences);
  assert.equal(await getPendingMutationCount(), 2);
  const expiredGeneration = getSessionGeneration();
  await expireSession(expiredGeneration);
  assert.equal(await getSessionToken(), null); assert.equal(await getCachedUser(), null);
  owner = { ...alice, id: 'bob' }; await setSessionToken('bob-token'); await fetchMe(); offline = false;
  assert.equal(await getPendingMutationCount(), 0); await flushPendingMutations(); await syncPendingPreferences();
  assert.equal(writes, 0);
  owner = alice; await setSessionToken('alice-after-expiry'); await fetchMe();
  assert.equal(await getPendingMutationCount(), 2);
  assert.equal(await expireSession(expiredGeneration), false);
  assert.equal(await getSessionToken(), 'alice-after-expiry');
  await flushPendingMutations(); await syncPendingPreferences();
  assert.equal(await getPendingMutationCount(), 0); assert.equal(writes, 2);
});

test('a refresh queued behind a newer sign-in cannot replace that session', async (t) => {
  const base = createMemoryStorage(); let pause = false;
  let release!: () => void; let entered!: () => void; let finishRefresh!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const response = new Promise<void>((resolve) => { finishRefresh = resolve; });
  const storage = { ...base, async getItem(key: string) {
    if (pause && key === '@3plates/cache/me') { pause = false; entered(); await waiting; }
    return base.getItem(key);
  } };
  const client = createClientOverrides({ me: async () => ({ status: 200, body: createBaseUser() }),
    authRefresh: async () => { await response; return { status: 200, body: { sessionToken: 'alice-refreshed', user: createBaseUser() } }; } });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('alice'); await fetchMe();
  const refresh = refreshSessionAndPersist();
  const rejected = assert.rejects(refresh, /active account changed/);
  pause = true; const signIn = setSessionToken('bob'); await started;
  finishRefresh(); await new Promise<void>((resolve) => setImmediate(resolve));
  release(); await signIn; await rejected;
  assert.equal(await getSessionToken(), 'bob');
});

test('concurrent offline progress and device mutations both survive account queue writes', async (t) => {
  const backing = createMemoryStorage();
  const key = '@3plates/pending-mutations/user/user-1';
  const storage = { ...backing, async getItem(k: string) {
    const value = await backing.getItem(k);
    if (k === key) await new Promise((resolve) => setImmediate(resolve));
    return value;
  } };
  const client = createClientOverrides({ me: async () => ({ status: 200, body: createBaseUser() }),
    updateProgress: async () => { throw new Error('Network request failed'); },
    registerDevice: async () => { throw new Error('Network request failed'); } });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('queue-race'); await fetchMe();
  await Promise.all([updateProgress(createProgress()), registerDevice({ platform: 'ios', pushToken: 'concurrent-device' })]);
  const queue = JSON.parse((await backing.getItem(key))!);
  assert.deepEqual(queue.map((item: { type: string }) => item.type).sort(), ['registerDevice', 'updateProgress']);
});

test('flush checkpoints successes before a later 401 and preserves new concurrent writes', async (t) => {
  const storage = createMemoryStorage(); let online = false; let authorized = false; let progressWrites = 0;
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const client = createClientOverrides({ me: async () => ({ status: 200, body: createBaseUser() }),
    updateProgress: async () => { if (!online) throw new Error('Network request failed'); progressWrites++; return { status: 200, body: createProgress() }; },
    registerDevice: async () => {
      if (!online) throw new Error('Network request failed');
      if (authorized) return { status: 200, body: { registered: true } };
      entered(); await wait; return { status: 401, body: { ok: false, error: { code: 'invalid_auth', message: 'Expired' } } };
    } });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('checkpoint'); await fetchMe();
  await updateProgress(createProgress()); await registerDevice({ platform: 'ios', pushToken: 'old-device' });
  online = true; const flush = flushPendingMutations(); const rejected = assert.rejects(flush, /Expired/);
  await started;
  online = false;
  const concurrent = registerDevice({ platform: 'android', pushToken: 'new-device' });
  release(); await rejected; await concurrent;
  assert.equal(await getPendingMutationCount(), 2);
  online = true; authorized = true; await flushPendingMutations();
  assert.equal(progressWrites, 1); assert.equal(await getPendingMutationCount(), 0);
});

test('a flush waiting behind a preference operation cannot adopt a newer account', async (t) => {
  const storage = createMemoryStorage(); let activeUser = createBaseUser(); let progressWrites = 0;
  let release!: () => void; let entered!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const client = createClientOverrides({ me: async () => ({ status: 200, body: activeUser }),
    updatePreferences: async (input: { body: Preferences }) => { entered(); await wait; return { status: 200, body: input.body }; },
    updateProgress: async () => { progressWrites++; return { status: 200, body: createProgress() }; } });
  __setApiTestAdapters({ storage, client: client as never }); t.after(__resetApiTestAdapters);
  await setSessionToken('alice'); await fetchMe();
  const preference = assert.rejects(updatePreferences({ theme: 'dark', units: 'metric', reminderTime: '07:00' }), /active account changed/);
  await started;
  const flush = assert.rejects(flushPendingMutations(), /active account changed/);
  await new Promise((resolve) => setImmediate(resolve));
  await setSessionToken('bob'); activeUser = { ...activeUser, id: 'bob' }; await fetchMe();
  await storage.setItem('@3plates/pending-mutations/user/bob', JSON.stringify([{ id: 'bob-progress', type: 'updateProgress', payload: createProgress(), createdAt: new Date().toISOString() }]));
  release(); await preference; await flush;
  assert.equal(progressWrites, 0); assert.equal(await getPendingMutationCount(), 1);
});

test('queue flush deadlines release waiting local writes and retain unacknowledged work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.after(__resetApiTestAdapters);
  for (const phase of ['owner', 'mutation']) {
    const storage = createMemoryStorage(); let flushing = false; let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const stall = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true }); entered();
    });
    const client = createClientOverrides({
      me: async (input: { fetchOptions?: { signal: AbortSignal } }) => {
        if (flushing && phase === 'owner') return stall(input.fetchOptions!.signal);
        return { status: 200, body: createBaseUser() };
      },
      updateProgress: async () => ({ status: 200, body: createProgress() }),
      registerDevice: async (input: { fetchOptions?: { signal: AbortSignal } }) => {
        if (input.fetchOptions) return stall(input.fetchOptions.signal);
        throw new Error('Network request failed');
      },
    });
    __setApiTestAdapters({ storage, client: client as never });
    await setSessionToken('deadline-' + phase); await fetchMe();
    const key = '@3plates/pending-mutations/user/user-1';
    await storage.setItem(key, JSON.stringify([
      { id: 'progress', type: 'updateProgress', payload: createProgress(), createdAt: new Date().toISOString() },
      { id: 'device', type: 'registerDevice', payload: { platform: 'ios', pushToken: 'old' }, createdAt: new Date().toISOString() },
    ]));
    flushing = true; const flush = assert.rejects(flushPendingMutations(), { name: 'AbortError' });
    await started;
    const local = registerDevice({ platform: 'android', pushToken: 'new' });
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(10000); await flush; await local;
    const queue = JSON.parse((await storage.getItem(key))!);
    assert.equal(queue.length, phase === 'owner' ? 3 : 2);
    assert.ok(queue.some((item: { id: string }) => item.id === 'device'));
    await clearSession(); await setSessionToken('next-' + phase);
    assert.equal(await getSessionToken(), 'next-' + phase);
  }
});

test('queue owner checks preserve transient status, sessions and mutations in both sync paths', async (t) => {
  t.after(__resetApiTestAdapters);
  for (const synchronize of [flushPendingMutations, syncPendingPreferences]) {
    const storage = createMemoryStorage(); let status = 200; let owner = createBaseUser(); let online = false;
    const preferences: Preferences = { theme: 'dark', units: 'metric', reminderTime: '07:00' };
    const client = createClientOverrides({
      me: async () => ({ status, body: status === 200 ? owner : { ok: false, error: { code: 'invalid_auth', message: 'Upstream failure' } } }),
      updatePreferences: async () => ({ status: online ? 200 : 503, body: online ? preferences : null }),
    });
    __setApiTestAdapters({ storage, client: client as never });
    await setSessionToken('owner-check'); await fetchMe(); await updatePreferences(preferences);
    const key = '@3plates/pending-mutations/user/user-1'; const queued = await storage.getItem(key);
    for (status of [429, 503, 401]) {
      await assert.rejects(synchronize(), (error: unknown) => error instanceof ApiRequestError
        && error.status === status && error.code === (status === 401 ? 'invalid_auth' : null));
      assert.equal(await getSessionToken(), 'owner-check'); assert.equal(await storage.getItem(key), queued);
    }
    status = 200; owner = { ...owner, id: 'another-account' };
    await assert.rejects(synchronize(), (error: unknown) => error instanceof ApiRequestError && error.status === 401 && error.code === 'invalid_auth');
    assert.equal(await storage.getItem(key), queued);
    owner = createBaseUser(); online = true; await synchronize();
    assert.equal(await getPendingMutationCount(), 0); assert.equal(await getSessionToken(), 'owner-check');
  }
});

for (const linking of [false, true]) {
  test(`exchange requires a matching pending ${linking ? 'link' : 'login'} and sends private proof`, async (t) => {
    const storage = createMemoryStorage();
    const user = createBaseUser();
    let challenge = '';
    let exchanges = 0;
    const start = async ({ body }: { body: { exchangeChallenge: string } }) => {
      challenge = body.exchangeChallenge;
      return { status: 200, body: { ok: true, provider: 'google', state: 'pending-state', next: 'https://provider.test' } };
    };
    __setApiTestAdapters({ storage, client: createClientOverrides({
      authStart: start, authLinkStart: start,
      authExchange: async ({ body }: { body: { verifier: string } }) => {
        exchanges++;
        const { createHash } = await import('node:crypto');
        assert.equal(createHash('sha256').update(body.verifier).digest('hex'), challenge);
        return { status: 200, body: { sessionToken: 'new-session', user } };
      },
    }) as never });
    t.after(__resetApiTestAdapters);
    await setSessionToken('existing-session');
    await assert.rejects(redeemMobileAuthExchangeCode('unsolicited', 'foreign-state'), /pending sign-in/);
    await (linking ? startAuthLink : startAuth)('google', 'threeplates://auth/callback');
    await assert.rejects(redeemMobileAuthExchangeCode('unsolicited', 'foreign-state'), /pending sign-in/);
    assert.equal(exchanges, 0);
    assert.equal(await getSessionToken(), 'existing-session');
    await Promise.all([
      redeemMobileAuthExchangeCode('valid-code', 'pending-state'),
      redeemMobileAuthExchangeCode('valid-code', 'pending-state'),
    ]);
    assert.equal(await getSessionToken(), 'new-session');
    await assert.rejects(redeemMobileAuthExchangeCode('valid-code', 'pending-state'), /pending sign-in/);
    assert.equal(exchanges, 1);
  });
}

for (const phase of ['before', 'during'] as const) {
  test(`exchange cannot replace an account changed ${phase} redemption`, async (t) => {
    const storage = createMemoryStorage();
    let exchanges = 0;
    __setApiTestAdapters({ storage, client: createClientOverrides({
      authStart: async () => ({ status: 200, body: { state: 'pending-state' } }),
      authExchange: async () => {
        exchanges++;
        await setSessionToken('different-account');
        return { status: 200, body: { sessionToken: 'stale-session', user: createBaseUser() } };
      },
    }) as never });
    t.after(__resetApiTestAdapters);
    await startAuth('google', 'threeplates://auth/callback');
    if (phase === 'before') await setSessionToken('different-account');
    await assert.rejects(redeemMobileAuthExchangeCode('code', 'pending-state'), /active account changed/);
    assert.equal(await getSessionToken(), 'different-account');
    assert.equal(exchanges, phase === 'before' ? 0 : 1);
  });
}

test('exchange rejects expired and corrupt pending proof without contacting the server', async (t) => {
  const storage = createMemoryStorage();
  __setApiTestAdapters({ storage, client: createClientOverrides({
    authStart: async () => ({ status: 200, body: { state: 'pending-state' } }),
    authExchange: async () => { assert.fail('Invalid proof must not be exchanged'); },
  }) as never });
  t.after(__resetApiTestAdapters);
  await startAuth('google', 'threeplates://auth/callback');
  const pending = JSON.parse((await storage.getItem('threeplates-pending-auth'))!);
  await storage.setItem('threeplates-pending-auth', JSON.stringify({ ...pending, expiresAt: 0 }));
  await assert.rejects(redeemMobileAuthExchangeCode('code', 'pending-state'), /pending sign-in/);
  await storage.setItem('threeplates-pending-auth', '{broken');
  await assert.rejects(redeemMobileAuthExchangeCode('code', 'pending-state'), /pending sign-in/);
});
