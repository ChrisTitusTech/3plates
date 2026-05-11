import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createAuthService, createDbAuthRepository } from './auth-service.js';
import type { AuthProviderName, OAuthIdentity, OAuthProviderAdapter } from './auth-types.js';
import { env } from './env.js';
import { createServer } from './server.js';
import { createDbUserStateStore } from './user-state-store.js';

const repoRootDirectory = new URL('../../../', import.meta.url).pathname;

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

function createDbApp() {
  const store = createDbUserStateStore(env.DATABASE_URL ?? '');
  const authRepository = createDbAuthRepository(env.DATABASE_URL ?? '');

  const googleProfile: OAuthIdentity = {
    provider: 'google',
    providerSubjectId: `google-${randomUUID()}`,
    email: `google-${randomUUID()}@example.com`,
    emailVerified: true,
    displayName: 'Google Integration User',
  };

  const appleProfile: OAuthIdentity = {
    provider: 'apple',
    providerSubjectId: `apple-${randomUUID()}`,
    email: `apple-${randomUUID()}@example.com`,
    emailVerified: true,
    displayName: 'Apple Integration User',
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
    store,
    authRepository,
    googleProfile,
    appleProfile,
  };
}

async function withDbApp<T>(run: (context: ReturnType<typeof createDbApp>) => Promise<T>) {
  execSync('pnpm db:setup', { cwd: repoRootDirectory, stdio: 'inherit' });

  const context = createDbApp();

  try {
    return await run(context);
  } finally {
    await context.app.close();
    await context.authRepository.close?.();
    await context.store.close?.();
  }
}

async function signIn(app: ReturnType<typeof createDbApp>['app'], provider: AuthProviderName, redirectTo: string) {
  const startResponse = await app.inject({
    method: 'POST',
    url: '/auth/start',
    payload: {
      provider,
      redirectTo,
    },
  });

  assert.equal(startResponse.statusCode, 200);
  const startBody = startResponse.json();

  const callbackResponse = await app.inject({
    method: 'GET',
    url: `/auth/callback?provider=${provider}&code=${provider}-code&state=${encodeURIComponent(startBody.state)}`,
  });

  assert.equal(callbackResponse.statusCode, 200);
  return callbackResponse.json() as {
    sessionToken: string;
    expiresAt: string;
    user: { id: string; email: string | null; displayName: string | null };
    redirectTo: string | null;
  };
}

test('DB-backed auth sessions persist through Postgres', async () => {
  await withDbApp(async ({ app }) => {
    const signedIn = await signIn(app, 'google', 'http://localhost:3000/welcome');

    const meResponse = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: {
        authorization: `Bearer ${signedIn.sessionToken}`,
      },
    });

    assert.equal(meResponse.statusCode, 200);
    assert.equal(meResponse.json().id, signedIn.user.id);

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        authorization: `Bearer ${signedIn.sessionToken}`,
      },
    });

    assert.equal(refreshResponse.statusCode, 200);
    const refreshed = refreshResponse.json() as { sessionToken: string; user: { id: string } };
    assert.notEqual(refreshed.sessionToken, signedIn.sessionToken);
    assert.equal(refreshed.user.id, signedIn.user.id);

    const oldTokenResponse = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: {
        authorization: `Bearer ${signedIn.sessionToken}`,
      },
    });

    assert.equal(oldTokenResponse.statusCode, 401);

    const refreshedTokenResponse = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: {
        authorization: `Bearer ${refreshed.sessionToken}`,
      },
    });

    assert.equal(refreshedTokenResponse.statusCode, 200);
    assert.equal(refreshedTokenResponse.json().id, signedIn.user.id);
  });
});

test('DB-backed linked identities keep the same user record', async () => {
  await withDbApp(async ({ app }) => {
    const googleSession = await signIn(app, 'google', 'http://localhost:3000/welcome');

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

    const linkCallbackResponse = await app.inject({
      method: 'GET',
      url: `/auth/callback?provider=apple&code=apple-code&state=${encodeURIComponent(linkStartBody.state)}`,
    });

    assert.equal(linkCallbackResponse.statusCode, 200);
    const linkCallbackBody = linkCallbackResponse.json() as { sessionToken: string; user: { id: string } };

    assert.equal(linkCallbackBody.user.id, googleSession.user.id);

    const meResponse = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: {
        authorization: `Bearer ${linkCallbackBody.sessionToken}`,
      },
    });

    assert.equal(meResponse.statusCode, 200);
    assert.equal(meResponse.json().id, googleSession.user.id);
  });
});

test('DB-backed progress, preferences, and devices persist through Postgres', async () => {
  await withDbApp(async ({ app }) => {
    const signedIn = await signIn(app, 'google', 'http://localhost:3000/welcome');

    const progressPut = await app.inject({
      method: 'PUT',
      url: '/users/me/progress',
      headers: {
        authorization: `Bearer ${signedIn.sessionToken}`,
      },
      payload: {
        streakDays: 9,
        completedWorkouts: 27,
        lastWorkoutAt: '2026-05-10T12:34:56.000Z',
      },
    });

    assert.equal(progressPut.statusCode, 200);

    const progressGet = await app.inject({
      method: 'GET',
      url: '/users/me/progress',
      headers: {
        authorization: `Bearer ${signedIn.sessionToken}`,
      },
    });

    assert.equal(progressGet.statusCode, 200);
    assert.deepEqual(progressGet.json(), {
      streakDays: 9,
      completedWorkouts: 27,
      lastWorkoutAt: '2026-05-10T12:34:56.000Z',
    });

    const preferencesPut = await app.inject({
      method: 'PUT',
      url: '/users/me/preferences',
      headers: {
        authorization: `Bearer ${signedIn.sessionToken}`,
      },
      payload: {
        theme: 'dark',
        units: 'imperial',
        reminderTime: '06:45',
      },
    });

    assert.equal(preferencesPut.statusCode, 200);

    const preferencesGet = await app.inject({
      method: 'GET',
      url: '/users/me/preferences',
      headers: {
        authorization: `Bearer ${signedIn.sessionToken}`,
      },
    });

    assert.equal(preferencesGet.statusCode, 200);
    assert.deepEqual(preferencesGet.json(), {
      theme: 'dark',
      units: 'imperial',
      reminderTime: '06:45',
    });

    const deviceFirst = await app.inject({
      method: 'POST',
      url: '/notifications/devices',
      headers: {
        authorization: `Bearer ${signedIn.sessionToken}`,
      },
      payload: {
        platform: 'web',
        pushToken: 'push-token-shared',
      },
    });

    assert.equal(deviceFirst.statusCode, 200);

    const deviceSecond = await app.inject({
      method: 'POST',
      url: '/notifications/devices',
      headers: {
        authorization: `Bearer ${signedIn.sessionToken}`,
      },
      payload: {
        platform: 'android',
        pushToken: 'push-token-shared',
      },
    });

    assert.equal(deviceSecond.statusCode, 200);

    const unauthorizedResponse = await app.inject({
      method: 'GET',
      url: '/users/me/progress',
    });

    assert.equal(unauthorizedResponse.statusCode, 401);
  });
});