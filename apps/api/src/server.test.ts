import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import test from 'node:test';
import { jwtVerify } from 'jose';

import { createServer } from './server.js';
import { createAppleOAuthProvider, createAuthService, createMemoryAuthRepository } from './auth-service.js';
import { env } from './env.js';
import { computeStreakUpdate, createMemoryUserStateStore } from './user-state-store.js';
import type { UserStateStore } from './user-state-store.js';
import { assertApiError, createFakeProvider, createTestAuthApp, signIn } from './test-support.js';

function createAuthenticatedApp() {
  const store = createMemoryUserStateStore();
  const authRepository = createMemoryAuthRepository();

  return createTestAuthApp({
    authRepository,
    store,
    displayNamePrefix: 'Demo',
  });
}

function createMissingUserStateApp() {
  const sessionUser = {
    id: randomUUID(),
    email: 'missing@example.com',
    displayName: 'Missing User',
  };

  const store: UserStateStore = {
    getOrCreateUser: async () => sessionUser,
    getUserById: async () => null,
    resolveOAuthIdentity: async () => ({
      user: sessionUser,
      isNewUser: false,
      effectiveLevel: 1,
    }),
    getUserEffectiveLevel: async () => 1,
    getProgress: async () => ({ streakDays: 0, completedWorkouts: 0, lastWorkoutAt: null }),
    updateProgress: async () => undefined,
    getPreferences: async () => ({ theme: 'system', units: 'metric', reminderTime: '07:00' }),
    updatePreferences: async () => undefined,
    registerDevice: async () => undefined,
    listWorkouts: async () => [],
    createWorkoutAdmin: async () => ({
      id: randomUUID(),
      title: 'placeholder',
      description: null,
      mode: 'active_recovery',
      isPublished: false,
      version: 1,
      createdBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: null,
    }),
    updateWorkoutAdmin: async () => ({
      id: randomUUID(),
      title: 'placeholder',
      description: null,
      mode: 'active_recovery',
      isPublished: false,
      version: 1,
      createdBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: null,
    }),
    setWorkoutPublishedAdmin: async () => ({
      id: randomUUID(),
      title: 'placeholder',
      description: null,
      mode: 'active_recovery',
      isPublished: false,
      version: 1,
      createdBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: null,
    }),
    updateStreakOnLogin: async () => undefined,
    close: async () => undefined,
  };

  const authRepository = createMemoryAuthRepository();

  const authService = createAuthService({
    authRepository,
    userStateStore: store,
    providers: {
      google: createFakeProvider('google', {
        provider: 'google',
        providerSubjectId: `google-${randomUUID()}`,
        email: 'missing@example.com',
        emailVerified: true,
        displayName: 'Missing User',
      }),
      apple: createFakeProvider('apple', {
        provider: 'apple',
        providerSubjectId: `apple-${randomUUID()}`,
        email: 'missing@example.com',
        emailVerified: true,
        displayName: 'Missing User',
      }),
    },
  });

  return {
    app: createServer({ store, authService }),
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

test('auth start, callback, and refresh issue real sessions', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const startResponse = await app.inject({
    method: 'POST',
    url: '/auth/start',
    payload: {
      provider: 'google',
      redirectTo: 'http://localhost:3000/welcome',
    },
  });

  assert.equal(startResponse.statusCode, 200);
  const startBody = startResponse.json();
  assert.equal(startBody.ok, true);
  assert.equal(startBody.provider, 'google');
  assert.match(startBody.next, /^https:\/\/auth\.example\/google/);
  assert.equal(typeof startBody.state, 'string');

  const callbackResponse = await app.inject({
    method: 'GET',
    url: `/auth/callback?provider=google&code=google-code&state=${encodeURIComponent(startBody.state)}`,
  });

  assert.equal(callbackResponse.statusCode, 200);
  const callbackBody = callbackResponse.json();
  assert.equal(callbackBody.ok, true);
  assert.equal(callbackBody.provider, 'google');
  assert.equal(callbackBody.user.email, callbackBody.user.email?.toLowerCase());
  assert.equal(callbackBody.isNewUser, true);
  assert.equal(callbackBody.effectiveLevel, 1);

  const meResponse = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: {
      authorization: `Bearer ${callbackBody.sessionToken}`,
    },
  });

  assert.equal(meResponse.statusCode, 200);
  assert.deepEqual(meResponse.json(), callbackBody.user);

  const refreshResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      authorization: `Bearer ${callbackBody.sessionToken}`,
    },
  });

  assert.equal(refreshResponse.statusCode, 200);
  const refreshBody = refreshResponse.json();
  assert.equal(refreshBody.ok, true);
  assert.equal(refreshBody.user.id, callbackBody.user.id);
  assert.notEqual(refreshBody.sessionToken, callbackBody.sessionToken);
  assert.equal(refreshBody.isNewUser, false);
  assert.equal(refreshBody.effectiveLevel, 1);

  const oldTokenResponse = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: {
      authorization: `Bearer ${callbackBody.sessionToken}`,
    },
  });

  assert.equal(oldTokenResponse.statusCode, 401);

  const refreshedUserResponse = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: {
      authorization: `Bearer ${refreshBody.sessionToken}`,
    },
  });

  assert.equal(refreshedUserResponse.statusCode, 200);
  assert.deepEqual(refreshedUserResponse.json(), callbackBody.user);
});

test('Apple OAuth provider generates client secrets from signing key config', async (t) => {
  const originalAppleConfig = {
    AUTH_APPLE_CLIENT_ID: env.AUTH_APPLE_CLIENT_ID,
    AUTH_APPLE_TEAM_ID: env.AUTH_APPLE_TEAM_ID,
    AUTH_APPLE_KEY_ID: env.AUTH_APPLE_KEY_ID,
    AUTH_APPLE_PRIVATE_KEY: env.AUTH_APPLE_PRIVATE_KEY,
    AUTH_APPLE_PRIVATE_KEY_PATH: env.AUTH_APPLE_PRIVATE_KEY_PATH,
  };
  const originalFetch = globalThis.fetch;
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const privateKeyPem = privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }).toString();
  const capturedBodies: URLSearchParams[] = [];

  Object.assign(env, {
    AUTH_APPLE_CLIENT_ID: 'com.example.3plates.web',
    AUTH_APPLE_TEAM_ID: 'TEAM123456',
    AUTH_APPLE_KEY_ID: 'KEY1234567',
    AUTH_APPLE_PRIVATE_KEY: privateKeyPem,
    AUTH_APPLE_PRIVATE_KEY_PATH: undefined,
  });

  globalThis.fetch = async (_input, init) => {
    if (init?.body instanceof URLSearchParams) {
      capturedBodies.push(init.body);
    }

    return new Response(null, { status: 400 });
  };

  t.after(() => {
    Object.assign(env, originalAppleConfig);
    globalThis.fetch = originalFetch;
  });

  const provider = createAppleOAuthProvider();
  await assert.rejects(
    provider.exchangeCode({
      code: 'apple-code',
      redirectUri: 'https://api.example.com/auth/callback',
      codeVerifier: 'verifier',
    }),
    /Apple token exchange failed/,
  );

  const capturedBody = capturedBodies[0];
  assert.ok(capturedBody);
  assert.equal(capturedBody.get('client_id'), 'com.example.3plates.web');
  assert.equal(capturedBody.get('grant_type'), 'authorization_code');

  const clientSecret = capturedBody.get('client_secret');
  assert.ok(clientSecret);

  const { protectedHeader, payload } = await jwtVerify(clientSecret, publicKey, {
    issuer: 'TEAM123456',
    subject: 'com.example.3plates.web',
    audience: 'https://appleid.apple.com',
  });

  assert.equal(protectedHeader.alg, 'ES256');
  assert.equal(protectedHeader.kid, 'KEY1234567');
  assert.equal(payload.iss, 'TEAM123456');
  assert.equal(payload.sub, 'com.example.3plates.web');
  assert.equal(payload.aud, 'https://appleid.apple.com');
});

test('auth sign-out revokes the active bearer session', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const { sessionToken } = await signIn(app, 'google');

  const signOutResponse = await app.inject({
    method: 'POST',
    url: '/auth/sign-out',
    headers: {
      authorization: `Bearer ${sessionToken}`,
    },
    payload: {},
  });

  assert.equal(signOutResponse.statusCode, 200);
  assert.deepEqual(signOutResponse.json(), {
    signedOut: true,
  });

  const revokedTokenResponse = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: {
      authorization: `Bearer ${sessionToken}`,
    },
  });

  assert.equal(revokedTokenResponse.statusCode, 401);

  const missingTokenResponse = await app.inject({
    method: 'POST',
    url: '/auth/sign-out',
    payload: {},
  });

  assert.equal(missingTokenResponse.statusCode, 401);
  assertApiError(
    missingTokenResponse.json(),
    'invalid_auth',
    'Authentication required.',
  );
});

test('auth routes return typed errors for invalid payload and stale callbacks', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const invalidStartResponse = await app.inject({
    method: 'POST',
    url: '/auth/start',
    payload: {
      provider: 'github',
      redirectTo: 'http://localhost:3000/welcome',
    },
  });

  assert.equal(invalidStartResponse.statusCode, 400);
  assertApiError(invalidStartResponse.json(), 'invalid_request_payload', 'Request payload is invalid.');

  const startResponse = await app.inject({
    method: 'POST',
    url: '/auth/start',
    payload: {
      provider: 'google',
      redirectTo: 'http://localhost:3000/welcome',
    },
  });

  assert.equal(startResponse.statusCode, 200);
  const startBody = startResponse.json();

  const firstCallbackResponse = await app.inject({
    method: 'GET',
    url: `/auth/callback?provider=google&code=google-code&state=${encodeURIComponent(startBody.state)}`,
  });

  assert.equal(firstCallbackResponse.statusCode, 200);

  const staleCallbackResponse = await app.inject({
    method: 'GET',
    url: `/auth/callback?provider=google&code=google-code&state=${encodeURIComponent(startBody.state)}`,
  });

  assert.equal(staleCallbackResponse.statusCode, 409);
  assertApiError(
    staleCallbackResponse.json(),
    'conflict_or_stale_update',
    'OAuth transaction is missing or expired.',
  );
});

test('auth callback redirects to native deep link with an exchange code and redeem succeeds once', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const startResponse = await app.inject({
    method: 'POST',
    url: '/auth/start',
    payload: {
      provider: 'google',
      redirectTo: 'threeplates://auth-finished',
    },
  });

  assert.equal(startResponse.statusCode, 200);
  const startBody = startResponse.json();

  const callbackResponse = await app.inject({
    method: 'GET',
    url: `/auth/callback?provider=google&code=google-code&state=${encodeURIComponent(startBody.state)}`,
  });

  assert.equal(callbackResponse.statusCode, 302);
  const redirectLocation = callbackResponse.headers.location;
  if (!redirectLocation) {
    throw new Error('Expected callback response to include a redirect location header.');
  }

  const redirectUrl = new URL(redirectLocation);
  assert.equal(redirectUrl.protocol, 'threeplates:');
  assert.equal(redirectUrl.searchParams.get('provider'), 'google');
  const exchangeCode = redirectUrl.searchParams.get('exchangeCode');
  assert.equal(typeof exchangeCode, 'string');
  assert.equal(typeof redirectUrl.searchParams.get('expiresAt'), 'string');

  const redeemResponse = await app.inject({
    method: 'POST',
    url: '/auth/exchange',
    payload: {
      code: exchangeCode,
    },
  });

  assert.equal(redeemResponse.statusCode, 200);
  const redeemBody = redeemResponse.json();
  assert.equal(redeemBody.ok, true);
  assert.equal(typeof redeemBody.sessionToken, 'string');

  const meResponse = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: {
      authorization: `Bearer ${redeemBody.sessionToken}`,
    },
  });

  assert.equal(meResponse.statusCode, 200);

  const staleRedeemResponse = await app.inject({
    method: 'POST',
    url: '/auth/exchange',
    payload: {
      code: exchangeCode,
    },
  });

  assert.equal(staleRedeemResponse.statusCode, 409);
  assertApiError(
    staleRedeemResponse.json(),
    'conflict_or_stale_update',
    'Exchange code is missing or expired.',
  );
});

test('missing user state returns a typed 404 response', async (t) => {
  const { app } = createMissingUserStateApp();
  t.after(async () => {
    await app.close();
  });

  const startResponse = await app.inject({
    method: 'POST',
    url: '/auth/start',
    payload: {
      provider: 'google',
      redirectTo: 'http://localhost:3000/welcome',
    },
  });

  assert.equal(startResponse.statusCode, 200);
  const startBody = startResponse.json();

  const callbackResponse = await app.inject({
    method: 'GET',
    url: `/auth/callback?provider=google&code=google-code&state=${encodeURIComponent(startBody.state)}`,
  });

  assert.equal(callbackResponse.statusCode, 200);
  const callbackBody = callbackResponse.json();

  const meResponse = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: {
      authorization: `Bearer ${callbackBody.sessionToken}`,
    },
  });

  assert.equal(meResponse.statusCode, 404);
  assertApiError(meResponse.json(), 'missing_user_state', 'Session belongs to a deleted user.');
});

test('auth link keeps the existing account and links a second identity', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const googleSession = await signIn(app, 'google');

  const linkStartResponse = await app.inject({
    method: 'POST',
    url: '/auth/link',
    headers: {
      authorization: `Bearer ${googleSession.sessionToken}`,
    },
    payload: {
      provider: 'apple',
      redirectTo: 'http://localhost:3000/settings',
    },
  });

  assert.equal(linkStartResponse.statusCode, 200);
  const linkStartBody = linkStartResponse.json();
  assert.equal(linkStartBody.provider, 'apple');

  const linkCallbackResponse = await app.inject({
    method: 'GET',
    url: `/auth/callback?provider=apple&code=apple-code&state=${encodeURIComponent(linkStartBody.state)}`,
  });

  assert.equal(linkCallbackResponse.statusCode, 200);
  const linkCallbackBody = linkCallbackResponse.json();
  assert.equal(linkCallbackBody.user.id, googleSession.user.id);
  assert.equal(linkCallbackBody.isNewUser, false);
  assert.equal(linkCallbackBody.effectiveLevel, 1);

  const linkedUserResponse = await app.inject({
    method: 'GET',
    url: '/users/me',
    headers: {
      authorization: `Bearer ${linkCallbackBody.sessionToken}`,
    },
  });

  assert.equal(linkedUserResponse.statusCode, 200);
  assert.equal(linkedUserResponse.json().id, googleSession.user.id);
});

test('auth link rejects an identity already linked to another user', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const googleSession = await signIn(app, 'google');
  const appleSession = await signIn(app, 'apple');
  assert.notEqual(appleSession.user.id, googleSession.user.id);

  const linkStartResponse = await app.inject({
    method: 'POST',
    url: '/auth/link',
    headers: {
      authorization: `Bearer ${googleSession.sessionToken}`,
    },
    payload: {
      provider: 'apple',
      redirectTo: 'http://localhost:3000/settings',
    },
  });

  assert.equal(linkStartResponse.statusCode, 200);
  const linkStartBody = linkStartResponse.json() as { state: string };

  const linkCallbackResponse = await app.inject({
    method: 'GET',
    url: `/auth/callback?provider=apple&code=apple-code&state=${encodeURIComponent(linkStartBody.state)}`,
  });

  assert.equal(linkCallbackResponse.statusCode, 409);
  assertApiError(
    linkCallbackResponse.json(),
    'conflict_or_stale_update',
    'Identity is already linked to another account.',
  );
});

test('returning sign-in is not marked as a new user and keeps level', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const startFirst = await app.inject({
    method: 'POST',
    url: '/auth/start',
    payload: {
      provider: 'google',
      redirectTo: 'http://localhost:3000/welcome',
    },
  });
  assert.equal(startFirst.statusCode, 200);
  const firstState = startFirst.json().state as string;

  const firstCallback = await app.inject({
    method: 'GET',
    url: `/auth/callback?provider=google&code=google-code&state=${encodeURIComponent(firstState)}`,
  });
  assert.equal(firstCallback.statusCode, 200);
  assert.equal(firstCallback.json().isNewUser, true);
  assert.equal(firstCallback.json().effectiveLevel, 1);

  const startSecond = await app.inject({
    method: 'POST',
    url: '/auth/start',
    payload: {
      provider: 'google',
      redirectTo: 'http://localhost:3000/welcome',
    },
  });
  assert.equal(startSecond.statusCode, 200);
  const secondState = startSecond.json().state as string;

  const secondCallback = await app.inject({
    method: 'GET',
    url: `/auth/callback?provider=google&code=google-code&state=${encodeURIComponent(secondState)}`,
  });
  assert.equal(secondCallback.statusCode, 200);
  assert.equal(secondCallback.json().isNewUser, false);
  assert.equal(secondCallback.json().effectiveLevel, 1);
});

test('stateful user endpoints persist per-user state using bearer sessions', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const session = await signIn(app, 'google');

  const progressGet = await app.inject({
    method: 'GET',
    url: '/users/me/progress',
    headers: {
      authorization: `Bearer ${session.sessionToken}`,
    },
  });

  assert.equal(progressGet.statusCode, 200);
  assert.deepEqual(progressGet.json(), {
    streakDays: 1,
    completedWorkouts: 0,
    lastWorkoutAt: null,
  });

  const progressPut = await app.inject({
    method: 'PUT',
    url: '/users/me/progress',
    headers: {
      authorization: `Bearer ${session.sessionToken}`,
    },
    payload: {
      streakDays: 4,
      completedWorkouts: 16,
      lastWorkoutAt: '2026-05-09T12:00:00.000Z',
    },
  });

  assert.equal(progressPut.statusCode, 200);

  const progressPersisted = await app.inject({
    method: 'GET',
    url: '/users/me/progress',
    headers: {
      authorization: `Bearer ${session.sessionToken}`,
    },
  });

  assert.equal(progressPersisted.statusCode, 200);
  assert.deepEqual(progressPersisted.json(), {
    streakDays: 4,
    completedWorkouts: 16,
    lastWorkoutAt: '2026-05-09T12:00:00.000Z',
  });

  const preferencesPut = await app.inject({
    method: 'PUT',
    url: '/users/me/preferences',
    headers: {
      authorization: `Bearer ${session.sessionToken}`,
    },
    payload: {
      units: 'imperial',
      reminderTime: '08:30',
      theme: 'dark',
    },
  });

  assert.equal(preferencesPut.statusCode, 200);

  const notificationResponse = await app.inject({
    method: 'POST',
    url: '/notifications/devices',
    headers: {
      authorization: `Bearer ${session.sessionToken}`,
    },
    payload: {
      platform: 'ios',
      pushToken: 'push-token-1',
    },
  });

  assert.equal(notificationResponse.statusCode, 200);
});

test('workouts endpoint returns published workouts filtered by selected mode', async (t) => {
  const { app, store } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  store.seedWorkout({
    id: randomUUID(),
    title: 'Easy Row 20',
    description: 'Recovery pace',
    mode: 'active_recovery',
    isPublished: true,
  });
  store.seedWorkout({
    id: randomUUID(),
    title: 'Heavy Fran',
    description: 'Strength metcon session',
    mode: 'strength_metcon',
    isPublished: true,
  });
  store.seedWorkout({
    id: randomUUID(),
    title: 'Draft Workout',
    description: null,
    mode: 'active_recovery',
    isPublished: false,
  });

  const session = await signIn(app, 'google');

  const response = await app.inject({
    method: 'GET',
    url: '/workouts?mode=active_recovery',
    headers: {
      authorization: `Bearer ${session.sessionToken}`,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    workouts: Array<{
      title: string;
      mode: string;
      isPublished: boolean;
    }>;
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
    ordering: {
      applied: string;
    };
  };

  assert.equal(body.workouts.length, 1);
  assert.equal(body.workouts[0]?.title, 'Easy Row 20');
  assert.equal(body.workouts[0]?.mode, 'active_recovery');
  assert.equal(body.workouts[0]?.isPublished, true);
  assert.deepEqual(body.pagination, {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  assert.equal(body.ordering.applied, 'published_at_desc_created_at_desc_id_asc');
});

test('admin workouts routes require admin key authentication', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const originalAdminApiKey = env.ADMIN_API_KEY;
  env.ADMIN_API_KEY = 'test-admin-key';
  t.after(() => {
    env.ADMIN_API_KEY = originalAdminApiKey;
  });

  const response = await app.inject({
    method: 'POST',
    url: '/admin/workouts',
    payload: {
      title: 'Admin Workout',
      description: null,
      mode: 'active_recovery',
      isPublished: false,
    },
  });

  assert.equal(response.statusCode, 401);
  assertApiError(response.json(), 'admin_auth_required', 'Admin authentication required.');
});

test('admin workouts routes reject placeholder admin key configuration', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const originalAdminApiKey = env.ADMIN_API_KEY;
  env.ADMIN_API_KEY = 'replace-me-admin-key';
  t.after(() => {
    env.ADMIN_API_KEY = originalAdminApiKey;
  });

  const response = await app.inject({
    method: 'POST',
    url: '/admin/workouts',
    headers: {
      'x-admin-key': 'replace-me-admin-key',
    },
    payload: {
      title: 'Admin Workout',
      description: null,
      mode: 'active_recovery',
      isPublished: false,
    },
  });

  assert.equal(response.statusCode, 401);
  assertApiError(response.json(), 'admin_auth_required', 'Admin authentication required.');
});

test('admin workout write path supports create, update, publish and unpublish with optimistic concurrency', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const originalAdminApiKey = env.ADMIN_API_KEY;
  env.ADMIN_API_KEY = 'test-admin-key';
  t.after(() => {
    env.ADMIN_API_KEY = originalAdminApiKey;
  });

  assert.ok(env.ADMIN_API_KEY, 'ADMIN_API_KEY must be set for admin route tests.');
  const adminHeaders = {
    'x-admin-key': env.ADMIN_API_KEY as string,
  };

  const createResponse = await app.inject({
    method: 'POST',
    url: '/admin/workouts',
    headers: adminHeaders,
    payload: {
      title: 'Tempo Intervals',
      description: 'Threshold session',
      mode: 'strength_metcon',
      isPublished: false,
    },
  });

  assert.equal(createResponse.statusCode, 200);
  const created = createResponse.json() as {
    id: string;
    version: number;
    isPublished: boolean;
    createdBy: string | null;
    publishedAt: string | null;
  };
  assert.equal(created.version, 1);
  assert.equal(created.isPublished, false);
  assert.equal(created.createdBy, 'api-key');
  assert.equal(created.publishedAt, null);

  const staleUpdateResponse = await app.inject({
    method: 'PATCH',
    url: `/admin/workouts/${created.id}`,
    headers: adminHeaders,
    payload: {
      expectedVersion: 999,
      title: 'Should Fail',
    },
  });

  assert.equal(staleUpdateResponse.statusCode, 409);
  assertApiError(staleUpdateResponse.json(), 'conflict_or_stale_update', 'Workout update is stale or the workout is missing.');

  const updateResponse = await app.inject({
    method: 'PATCH',
    url: `/admin/workouts/${created.id}`,
    headers: adminHeaders,
    payload: {
      expectedVersion: 1,
      title: 'Tempo Intervals 2',
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  const updated = updateResponse.json() as {
    version: number;
    title: string;
  };
  assert.equal(updated.version, 2);
  assert.equal(updated.title, 'Tempo Intervals 2');

  const publishResponse = await app.inject({
    method: 'POST',
    url: `/admin/workouts/${created.id}/publish`,
    headers: adminHeaders,
    payload: {
      expectedVersion: 2,
    },
  });

  assert.equal(publishResponse.statusCode, 200);
  const published = publishResponse.json() as {
    version: number;
    isPublished: boolean;
    publishedAt: string | null;
  };
  assert.equal(published.version, 3);
  assert.equal(published.isPublished, true);
  assert.match(published.publishedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);

  const unpublishResponse = await app.inject({
    method: 'POST',
    url: `/admin/workouts/${created.id}/unpublish`,
    headers: adminHeaders,
    payload: {
      expectedVersion: 3,
    },
  });

  assert.equal(unpublishResponse.statusCode, 200);
  const unpublished = unpublishResponse.json() as {
    version: number;
    isPublished: boolean;
    publishedAt: string | null;
  };
  assert.equal(unpublished.version, 4);
  assert.equal(unpublished.isPublished, false);
  assert.equal(unpublished.publishedAt, null);
});

test('stateful user endpoints require an authenticated user session', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/users/me/progress',
  });

  assert.equal(response.statusCode, 401);
  assertApiError(response.json(), 'invalid_auth', 'Authentication required.');
});

test('auth guard returns typed invalid_auth for unknown session tokens', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/users/me/progress',
    headers: {
      authorization: 'Bearer not-a-real-session-token',
    },
  });

  assert.equal(response.statusCode, 401);
  assertApiError(response.json(), 'invalid_auth', 'Authentication required.');
});

test('auth session routes require a bearer token for refresh and link', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const refreshResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
  });

  assert.equal(refreshResponse.statusCode, 401);
  assertApiError(refreshResponse.json(), 'invalid_auth', 'Authentication required.');

  const linkResponse = await app.inject({
    method: 'POST',
    url: '/auth/link',
    payload: {
      provider: 'apple',
      redirectTo: 'http://localhost:3000/settings',
    },
  });

  assert.equal(linkResponse.statusCode, 401);
  assertApiError(linkResponse.json(), 'invalid_auth', 'Authentication required.');
});

test('auth refresh rejects expired session tokens', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const startResponse = await app.inject({
    method: 'POST',
    url: '/auth/start',
    payload: {
      provider: 'google',
      redirectTo: 'http://localhost:3000/welcome',
    },
  });

  assert.equal(startResponse.statusCode, 200);
  const startBody = startResponse.json();

  const callbackResponse = await app.inject({
    method: 'GET',
    url: `/auth/callback?provider=google&code=google-code&state=${encodeURIComponent(startBody.state)}`,
  });

  assert.equal(callbackResponse.statusCode, 200);
  const callbackBody = callbackResponse.json() as {
    sessionToken: string;
    expiresAt: string;
  };

  const originalDateNow = Date.now;
  t.after(() => {
    Date.now = originalDateNow;
  });

  const sessionExpiresAtMs = Date.parse(callbackBody.expiresAt);
  Date.now = () => sessionExpiresAtMs + 1;

  const refreshResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: {
      authorization: `Bearer ${callbackBody.sessionToken}`,
    },
  });

  assert.equal(refreshResponse.statusCode, 401);
  assertApiError(refreshResponse.json(), 'invalid_auth', 'Authentication required.');
});

test('progress updates apply last-write-wins conflict semantics', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const session = await signIn(app, 'google');

  const firstUpdateResponse = await app.inject({
    method: 'PUT',
    url: '/users/me/progress',
    headers: {
      authorization: `Bearer ${session.sessionToken}`,
    },
    payload: {
      streakDays: 3,
      completedWorkouts: 10,
      lastWorkoutAt: '2026-05-10T08:00:00.000Z',
    },
  });

  assert.equal(firstUpdateResponse.statusCode, 200);

  const secondUpdateResponse = await app.inject({
    method: 'PUT',
    url: '/users/me/progress',
    headers: {
      authorization: `Bearer ${session.sessionToken}`,
    },
    payload: {
      streakDays: 8,
      completedWorkouts: 30,
      lastWorkoutAt: '2026-05-11T09:15:00.000Z',
    },
  });

  assert.equal(secondUpdateResponse.statusCode, 200);

  const persistedProgressResponse = await app.inject({
    method: 'GET',
    url: '/users/me/progress',
    headers: {
      authorization: `Bearer ${session.sessionToken}`,
    },
  });

  assert.equal(persistedProgressResponse.statusCode, 200);
  assert.deepEqual(persistedProgressResponse.json(), {
    streakDays: 8,
    completedWorkouts: 30,
    lastWorkoutAt: '2026-05-11T09:15:00.000Z',
  });
});

test('notification registration dedupes by push token and reassigns ownership', async (t) => {
  const { app, store } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const googleSession = await signIn(app, 'google');
  const appleSession = await signIn(app, 'apple');

  const sharedPushToken = `push-token-${randomUUID()}`;

  const firstRegistration = await app.inject({
    method: 'POST',
    url: '/notifications/devices',
    headers: {
      authorization: `Bearer ${googleSession.sessionToken}`,
    },
    payload: {
      platform: 'web',
      pushToken: sharedPushToken,
    },
  });

  assert.equal(firstRegistration.statusCode, 200);
  assert.deepEqual(store.listDevicesForUser(googleSession.user.id), [
    {
      platform: 'web',
      pushToken: sharedPushToken,
    },
  ]);

  const secondRegistration = await app.inject({
    method: 'POST',
    url: '/notifications/devices',
    headers: {
      authorization: `Bearer ${appleSession.sessionToken}`,
    },
    payload: {
      platform: 'android',
      pushToken: sharedPushToken,
    },
  });

  assert.equal(secondRegistration.statusCode, 200);
  assert.deepEqual(store.listDevicesForUser(googleSession.user.id), []);
  assert.deepEqual(store.listDevicesForUser(appleSession.user.id), [
    {
      platform: 'android',
      pushToken: sharedPushToken,
    },
  ]);
});

test('streak engine: first sign-in sets streak day count to 1', async (t) => {
  const { app } = createAuthenticatedApp();
  t.after(async () => {
    await app.close();
  });

  const session = await signIn(app, 'google');

  const progressGet = await app.inject({
    method: 'GET',
    url: '/users/me/progress',
    headers: { authorization: `Bearer ${session.sessionToken}` },
  });

  assert.equal(progressGet.statusCode, 200);
  assert.equal(progressGet.json().streakDays, 1);
});

test('streak engine: computeStreakUpdate - first login initializes streak', () => {
  const result = computeStreakUpdate({ streakDays: 0, lastStreakDate: null }, '2026-05-15');
  assert.deepEqual(result, { streakDays: 1, lastStreakDate: '2026-05-15' });
});

test('streak engine: computeStreakUpdate - same-day login is idempotent', () => {
  const today = '2026-05-15';
  const first = computeStreakUpdate({ streakDays: 0, lastStreakDate: null }, today);
  const second = computeStreakUpdate(first, today);
  assert.deepEqual(second, { streakDays: 1, lastStreakDate: today });
});

test('streak engine: computeStreakUpdate - consecutive days increment streak', () => {
  const day1 = '2026-05-14';
  const day2 = '2026-05-15';
  const after1 = computeStreakUpdate({ streakDays: 0, lastStreakDate: null }, day1);
  const after2 = computeStreakUpdate(after1, day2);
  assert.equal(after2.streakDays, 2);
  assert.equal(after2.lastStreakDate, day2);
});

test('streak engine: computeStreakUpdate - missed day resets streak to 1', () => {
  const day1 = '2026-05-12';
  const day3 = '2026-05-14';
  const after1 = computeStreakUpdate({ streakDays: 5, lastStreakDate: day1 }, day3);
  assert.equal(after1.streakDays, 1);
  assert.equal(after1.lastStreakDate, day3);
});
