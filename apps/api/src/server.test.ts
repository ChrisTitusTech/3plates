import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createServer } from './server.js';
import { createAuthService, createMemoryAuthRepository } from './auth-service.js';
import type { AuthProviderName, OAuthIdentity, OAuthProviderAdapter } from './auth-types.js';
import { createMemoryUserStateStore } from './user-state-store.js';
import type { UserStateStore } from './user-state-store.js';

function createFakeProvider(provider: AuthProviderName, profile: OAuthIdentity): OAuthProviderAdapter {
  return {
    provider,
    buildAuthorizationUrl({ state }) {
      return `https://auth.example/${provider}?state=${state}`;
    },
    async exchangeCode() {
      return profile;
    },
  };
}

function createAuthenticatedApp() {
  const store = createMemoryUserStateStore();
  const authRepository = createMemoryAuthRepository();

  const googleProfile: OAuthIdentity = {
    provider: 'google',
    providerSubjectId: `google-${randomUUID()}`,
    email: `google-${randomUUID()}@example.com`,
    emailVerified: true,
    displayName: 'Google Demo User',
  };

  const appleProfile: OAuthIdentity = {
    provider: 'apple',
    providerSubjectId: `apple-${randomUUID()}`,
    email: `apple-${randomUUID()}@example.com`,
    emailVerified: true,
    displayName: 'Apple Demo User',
  };

  const authService = createAuthService({
    authRepository,
    userStateStore: store,
    providers: {
      google: createFakeProvider('google', googleProfile),
      apple: createFakeProvider('apple', appleProfile),
    },
  });

  const app = createServer({ store, authService });

  return {
    app,
    authRepository,
    store,
    googleProfile,
    appleProfile,
  };
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
    resolveOAuthIdentity: async () => sessionUser,
    getProgress: async () => ({ streakDays: 0, completedWorkouts: 0, lastWorkoutAt: null }),
    updateProgress: async () => undefined,
    getPreferences: async () => ({ theme: 'system', units: 'metric', reminderTime: '07:00' }),
    updatePreferences: async () => undefined,
    registerDevice: async () => undefined,
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

function assertApiError(body: unknown, code: string, message: string) {
  assert.deepEqual(body, {
    ok: false,
    error: {
      code,
      message,
    },
  });
}

async function signIn(app: ReturnType<typeof createAuthenticatedApp>['app'], provider: AuthProviderName) {
  const startResponse = await app.inject({
    method: 'POST',
    url: '/auth/start',
    payload: {
      provider,
      redirectTo: 'http://localhost:3000/welcome',
    },
  });

  assert.equal(startResponse.statusCode, 200);
  const startBody = startResponse.json();

  const callbackUrl = new URL('/auth/callback', 'http://localhost:3000');
  callbackUrl.searchParams.set('provider', provider);
  callbackUrl.searchParams.set('code', `${provider}-code`);
  callbackUrl.searchParams.set('state', startBody.state);

  const callbackResponse = await app.inject({
    method: 'GET',
    url: callbackUrl.toString(),
  });

  assert.equal(callbackResponse.statusCode, 200);
  const callbackBody = callbackResponse.json();

  return {
    sessionToken: callbackBody.sessionToken as string,
    user: callbackBody.user as { id: string; email: string | null; displayName: string | null },
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
    streakDays: 0,
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