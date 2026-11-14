import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { HealthLogInput } from '@3plates/contract';
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
  return { app, store, health, calls, whoop };
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
  await f.app.ready(); assert.deepEqual(await f.store.pendingDeletions(), [user.id]);
  await f.app.close();
  f.whoop.request = async () => ({ status: 200, body: '{}', contentType: 'application/json' });
  const authService = createAuthService({ userStateStore: f.store, authRepository: createMemoryAuthRepository(), providers: { whoop: f.whoop.provider } });
  const restarted = createServer({ store: f.store, healthStore: f.health, whoop: f.whoop, authService }); t.after(() => restarted.close());
  await restarted.ready(); assert.deepEqual(await f.store.pendingDeletions(), []);
  assert.deepEqual(await f.store.listIdentities(user.id), []); assert.equal(await f.store.getUserById(user.id), null);
});
