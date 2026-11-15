import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { healthMutationSchema, type HealthLogInput } from '@3plates/contract';
import { createAuthService, createMemoryAuthRepository } from './auth-service.js';
import { createMemoryUserStateStore } from './user-state-store.js';
import { createMemoryHealthStore } from './health-store.js';
import { createFakeProvider, signIn } from './test-support.js';
import { createServer } from './server.js';
import type { WhoopService } from './whoop-service.js';

const water: HealthLogInput = { kind: 'hydration', date: '2026-11-14', timezone: 'UTC', notes: '', details: { milliliters: 300 } };
function fixture() {
  const store = createMemoryUserStateStore(); const health = createMemoryHealthStore();
  const calls: Array<{ subject: string; operation: string; body: unknown }> = [];
  const profile = (provider: 'google' | 'apple' | 'whoop') => ({ provider, providerSubjectId: provider + '-subject', email: 'same@example.com', emailVerified: true, displayName: provider });
  const whoop: WhoopService = {
    provider: createFakeProvider('whoop', profile('whoop')),
    async request(subject, operation, _method, _query, body) { calls.push({ subject, operation, body }); return { status: 200, body: JSON.stringify({ owner: subject }), contentType: 'application/json' }; },
    async ownsWorkout(subject, id) { return subject === 'whoop-subject' && id === 'owned'; },
    async workouts() { return []; }, async close() {},
  };
  const authService = createAuthService({ userStateStore: store, authRepository: createMemoryAuthRepository(), providers: {
    google: createFakeProvider('google', profile('google')), apple: createFakeProvider('apple', profile('apple')), whoop: whoop.provider,
  } });
  const app = createServer({ store, healthStore: health, whoop, authService });
  return { app, store, health, calls, whoop, authService };
}

test('same verified emails do not merge accounts; WHOOP routes derive ownership from the session', async (t) => {
  const f = fixture(); t.after(() => f.app.close());
  const google = await signIn(f.app, 'google'); const whoop = await signIn(f.app, 'whoop');
  assert.notEqual(google.user.id, whoop.user.id);
  const headers = { authorization: `Bearer ${whoop.sessionToken}`, 'x-internal-whoop-subject': 'victim', 'x-member-id': 'victim' };
  const response = await f.app.inject({ url: '/users/me/whoop/dashboard?memberId=victim', headers });
  assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), { owner: 'whoop-subject' });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal((await f.app.inject({ url: '/users/me/whoop/dashboard', headers: { authorization: `Bearer ${google.sessionToken}` } })).statusCode, 409);
  assert.equal((await f.app.inject('/users/me/whoop/dashboard')).statusCode, 401);
  assert.equal((await f.app.inject({ method: 'DELETE', url: '/users/me/identities/whoop', headers })).statusCode, 409);
});

test('manual writes are idempotent, versioned, validated, and scoped to their owner', async (t) => {
  const f = fixture(); t.after(() => f.app.close());
  const alice = await signIn(f.app, 'google'); const bob = await signIn(f.app, 'apple');
  const headers = { authorization: `Bearer ${alice.sessionToken}` };
  const mutation = { id: randomUUID(), mutationId: randomUUID(), expectedVersion: 0, entry: water };
  const post = (payload: unknown) => f.app.inject({ method: 'POST', url: '/users/me/logs', headers, payload: payload as object });
  const created = await post(mutation); assert.equal(created.statusCode, 200);
  assert.deepEqual((await post(mutation)).json(), created.json());
  assert.equal((await post({ ...mutation, entry: { ...water, details: { milliliters: 500 } } })).statusCode, 409);
  assert.equal((await post({ ...mutation, mutationId: randomUUID() })).statusCode, 409);
  const other = await f.app.inject({ url: '/users/me/logs', headers: { authorization: `Bearer ${bob.sessionToken}` } });
  assert.deepEqual(other.json().logs, []);
  assert.equal((await post({ ...mutation, id: randomUUID(), mutationId: randomUUID(), entry: { ...water, date: '2026-02-30' } })).statusCode, 400);
  assert.equal((await post({ ...mutation, mutationId: randomUUID(), expectedVersion: 1, entry: null })).statusCode, 200);
  assert.equal((await post({ ...mutation, mutationId: randomUUID(), expectedVersion: 2 })).statusCode, 409);
  const logs = await f.app.inject({ url: '/users/me/logs?limit=1', headers });
  assert.equal(logs.json().logs[0].entry, null);
});

test('maximum-size workouts sync while oversized bodies remain bounded per route', async (t) => {
  const f = fixture(); t.after(() => f.app.close());
  const session = await signIn(f.app, 'google');
  const headers = { authorization: `Bearer ${session.sessionToken}`, 'content-type': 'application/json' };
  const mutation = healthMutationSchema.parse({ id: randomUUID(), mutationId: randomUUID(), expectedVersion: 0,
    entry: { kind: 'workout', date: '2026-11-14', timezone: 'UTC', notes: '\u0000'.repeat(4000),
      details: { title: '\u0000'.repeat(200), sport: '\u0000'.repeat(80), durationMinutes: 1440,
        exercises: Array.from({ length: 100 }, () => ({ name: '\u0000'.repeat(100),
          sets: Array.from({ length: 50 }, () => ({ reps: 1000, weightKg: 1999.9999999999998 })) })) } } });
  const payload = JSON.stringify(mutation);
  assert.ok(Buffer.byteLength(payload) > 64 * 1024);
  const saved = await f.app.inject({ method: 'POST', url: '/users/me/logs', headers, payload });
  assert.equal(saved.statusCode, 200);
  const logs = await f.app.inject({ url: '/users/me/logs', headers });
  assert.deepEqual(logs.json().logs[0].entry, mutation.entry);
  const oversized = JSON.stringify({ ...mutation, padding: 'x'.repeat(1024 * 1024) });
  assert.equal((await f.app.inject({ method: 'POST', url: '/users/me/logs', headers, payload: oversized })).statusCode, 413);
  assert.equal((await f.app.inject({ method: 'PUT', url: '/users/me/preferences', headers, payload })).statusCode, 413);
});

test('linking preserves the account, validates workout ownership, and deletion disables login', async (t) => {
  const f = fixture(); t.after(() => f.app.close());
  const session = await signIn(f.app, 'google'); const headers = { authorization: `Bearer ${session.sessionToken}` };
  const start = await f.app.inject({ method: 'POST', url: '/auth/link', headers, payload: { provider: 'whoop' } });
  assert.equal(start.statusCode, 200);
  const callback = await f.app.inject(`/auth/callback?provider=whoop&code=test&state=${start.json().state}`);
  assert.equal(callback.statusCode, 200); assert.equal(callback.json().user.id, session.user.id);
  const entry = { kind: 'workout', date: '2026-11-14', timezone: 'UTC', notes: '', details: { title: 'Ride', sport: 'Cycling', durationMinutes: 30, exercises: [], linkedWhoopWorkoutId: 'victim' } };
  const payload = { id: randomUUID(), mutationId: randomUUID(), expectedVersion: 0, entry };
  assert.equal((await f.app.inject({ method: 'POST', url: '/users/me/logs', headers, payload })).statusCode, 409);
  payload.entry.details.linkedWhoopWorkoutId = 'owned';
  assert.equal((await f.app.inject({ method: 'POST', url: '/users/me/logs', headers, payload })).statusCode, 200);
  assert.equal((await f.app.inject({ method: 'DELETE', url: '/users/me', headers, payload: { confirmation: 'DELETE' } })).statusCode, 202);
  assert.equal((await f.app.inject({ url: '/users/me/logs', headers })).statusCode, 401);
  assert.deepEqual(await f.store.pendingDeletions(), [session.user.id]);
  await assert.rejects(f.store.resolveOAuthIdentity({ provider: 'google', providerSubjectId: 'google-subject', email: null, emailVerified: false, displayName: null }));
});

test('committed linked workouts replay their receipt even when the provider later deletes the source', async (t) => {
  const f = fixture(); t.after(() => f.app.close());
  const session = await signIn(f.app, 'whoop'); const headers = { authorization: `Bearer ${session.sessionToken}` };
  const payload = { id: randomUUID(), mutationId: randomUUID(), expectedVersion: 0,
    entry: { kind: 'workout', date: '2026-11-14', timezone: 'UTC', details: { title: 'Ride', sport: 'Cycling', durationMinutes: 30, linkedWhoopWorkoutId: 'owned' } } };
  const first = await f.app.inject({ method: 'POST', url: '/users/me/logs', headers, payload }); assert.equal(first.statusCode, 200);
  f.whoop.ownsWorkout = async () => false;
  const replay = await f.app.inject({ method: 'POST', url: '/users/me/logs', headers, payload }); assert.equal(replay.statusCode, 200);
  assert.deepEqual(first.json(), replay.json());
});

test('durable account deletion waits for WHOOP cleanup and resumes on the next startup', async (t) => {
  const f = fixture();
  const identity = { provider: 'whoop' as const, providerSubjectId: 'whoop-subject', email: null, emailVerified: false, displayName: 'Delete me' };
  const { user } = await f.store.resolveOAuthIdentity(identity); await f.store.requestDeletion(user.id);
  f.whoop.request = async () => ({ status: 503, body: '{}', contentType: 'application/json' });
  await f.app.ready(); await new Promise((resolve) => setImmediate(resolve)); assert.deepEqual(await f.store.pendingDeletions(), [user.id]);
  await f.app.close();
  f.whoop.request = async () => ({ status: 200, body: '{}', contentType: 'application/json' });
  const authService = createAuthService({ userStateStore: f.store, authRepository: createMemoryAuthRepository(), providers: { whoop: f.whoop.provider } });
  const restarted = createServer({ store: f.store, healthStore: f.health, whoop: f.whoop, authService }); t.after(() => restarted.close());
  await restarted.ready(); await new Promise((resolve) => setImmediate(resolve)); assert.deepEqual(await f.store.pendingDeletions(), []);
  assert.deepEqual(await f.store.listIdentities(user.id), []); assert.equal(await f.store.getUserById(user.id), null);
});

test('deletion cleanup advances beyond a full batch of failed WHOOP accounts', async (t) => {
  const f = fixture(); t.after(() => f.app.close());
  const ids: string[] = [];
  for (let i = 0; i < 101; i++) {
    const { user } = await f.store.resolveOAuthIdentity({ provider: 'whoop', providerSubjectId: `pending-${i}`, email: null, emailVerified: false, displayName: null });
    ids.push(user.id); await f.store.requestDeletion(user.id);
  }
  ids.sort();
  // The last account has no external data and must not wait for failing accounts.
  f.store.listIdentities = async (id) => id === ids[100] ? [] : [{ provider: 'whoop', providerSubjectId: id }];
  let attempts = 0;
  f.whoop.request = async () => { attempts++; return { status: 503, body: '{}', contentType: 'application/json' }; };
  await f.app.ready(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 100);
  assert.equal(await f.store.getUserById(ids[100]), null);
  assert.deepEqual(await f.store.pendingDeletions(), ids.slice(0, 100));
});

test('identity removal revokes a concurrently refreshed memory session', async (t) => {
  const f = fixture(); t.after(() => f.app.close());
  const session = await signIn(f.app, 'google');
  await f.store.resolveOAuthIdentity({ provider: 'apple', providerSubjectId: 'linked', email: null, emailVerified: false, displayName: null, linkedUserId: session.user.id });
  const [refreshed] = await Promise.all([f.authService.refreshSession(session.sessionToken), f.store.unlinkIdentity(session.user.id, 'apple')]);
  assert.equal(await f.authService.resolveRequestUser(session.sessionToken), null);
  if (refreshed) assert.equal(await f.authService.resolveRequestUser(refreshed.sessionToken), null);
});

test('a slow deletion cleanup does not delay API readiness', async (t) => {
  const f = fixture(); t.after(() => f.app.close());
  const { user } = await f.store.resolveOAuthIdentity({ provider: 'whoop', providerSubjectId: 'slow-delete', email: null, emailVerified: false, displayName: null });
  await f.store.requestDeletion(user.id);
  let release!: () => void; const waiting = new Promise<void>((resolve) => { release = resolve; });
  t.after(() => release());
  f.whoop.request = async () => { await waiting; return { status: 503, body: '{}', contentType: 'application/json' }; };
  try { assert.equal((await f.app.inject('/health')).statusCode, 200); }
  finally { release(); }
});

test('concurrent memory unlinks preserve the last sign-in method across provider cleanup', async () => {
  const store = createMemoryUserStateStore();
  const identity = { provider: 'whoop' as const, providerSubjectId: 'memory-unlink', email: null, emailVerified: false, displayName: null };
  const { user } = await store.resolveOAuthIdentity(identity);
  await store.resolveOAuthIdentity({ ...identity, provider: 'google', linkedUserId: user.id });
  let release!: () => void; let entered!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const first = store.unlinkIdentity(user.id, 'whoop', async () => { entered(); await waiting; });
  await started;
  const second = store.unlinkIdentity(user.id, 'google');
  const rejected = assert.rejects(second, /only login/);
  release(); await first; await rejected;
  assert.deepEqual((await store.listIdentities(user.id)).map((item) => item.provider), ['google']);
});

test('memory account deletion removes personal values while retaining other accounts', async () => {
  const store = createMemoryUserStateStore();
  const { user } = await store.resolveOAuthIdentity({ provider: 'whoop', providerSubjectId: 'memory-delete', email: null, emailVerified: false, displayName: null });
  await store.updatePreferences(user.id, { theme: 'dark', units: 'imperial', reminderTime: '08:00' });
  await store.createManualWorkout(user.id, { type: 'running_walking', date: '2026-11-15', distance: '5', duration: '30', wodName: '', workoutDetails: '', scale: 'scaled', score: '' });
  await store.updateStreakOnLogin(user.id, new Date('2026-11-15T12:00:00Z'));
  await store.registerDevice(user.id, { platform: 'ios', pushToken: 'removed-device' });
  await store.registerDevice('other', { platform: 'android', pushToken: 'retained-device' });
  await store.requestDeletion(user.id); await store.deleteAccount(user.id);
  assert.equal(await store.getUserById(user.id), null);
  assert.deepEqual(await store.listManualWorkouts(user.id), []);
  assert.deepEqual(await store.getProgress(user.id), { streakDays: 0, completedWorkouts: 0, lastWorkoutAt: null });
  assert.equal((await store.getPreferences(user.id)).theme, 'system');
  assert.deepEqual(store.listDevicesForUser(user.id), []);
  assert.equal(store.listDevicesForUser('other').length, 1);
  await store.updateStreakOnLogin(user.id, new Date('2026-11-16T12:00:00Z'));
  assert.equal((await store.getProgress(user.id)).streakDays, 1);
});
