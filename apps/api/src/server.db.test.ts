import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createDatabaseClient, notificationDevices, users, workouts } from '@3plates/db';
import { eq, sql } from 'drizzle-orm';

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

  const { db: cleanupDb, close: cleanupClose } = createDatabaseClient(process.env['DATABASE_URL'] ?? '');
  try {
    await cleanupDb.execute(sql`TRUNCATE workouts, users CASCADE`);
  } finally {
    await cleanupClose();
  }

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
    isNewUser: boolean;
    effectiveLevel: number;
    redirectTo: string | null;
  };
}

test('DB-backed auth sessions persist through Postgres', async () => {
  await withDbApp(async ({ app }) => {
    const signedIn = await signIn(app, 'google', 'http://localhost:3000/welcome');
    assert.equal(signedIn.isNewUser, true);
    assert.equal(signedIn.effectiveLevel, 1);

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
    const refreshed = refreshResponse.json() as {
      sessionToken: string;
      user: { id: string };
      isNewUser: boolean;
      effectiveLevel: number;
    };
    assert.notEqual(refreshed.sessionToken, signedIn.sessionToken);
    assert.equal(refreshed.user.id, signedIn.user.id);
    assert.equal(refreshed.isNewUser, false);
    assert.equal(refreshed.effectiveLevel, 1);

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

test('DB-backed returning sign-in keeps level and is not new user', async () => {
  await withDbApp(async ({ app }) => {
    const first = await signIn(app, 'google', 'http://localhost:3000/welcome');
    assert.equal(first.isNewUser, true);
    assert.equal(first.effectiveLevel, 1);

    const second = await signIn(app, 'google', 'http://localhost:3000/welcome');
    assert.equal(second.isNewUser, false);
    assert.equal(second.effectiveLevel, 1);
    assert.equal(second.user.id, first.user.id);
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
      timezone: null,
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

test('DB-backed workouts endpoint filters by mode and returns published entries only', async () => {
  await withDbApp(async ({ app }) => {
    const signedIn = await signIn(app, 'google', 'http://localhost:3000/welcome');
    const databaseUrl = env.DATABASE_URL ?? '';
    const { db, close } = createDatabaseClient(databaseUrl);

    try {
      await db.insert(workouts).values([
        {
          title: 'Walk 45',
          description: 'Low intensity recovery walk',
          mode: 'active_recovery',
          isPublished: true,
          publishedAt: new Date('2026-05-13T10:00:00.000Z'),
        },
        {
          title: 'Barbell Metcon',
          description: 'Strength metcon complex',
          mode: 'strength_metcon',
          isPublished: true,
          publishedAt: new Date('2026-05-13T11:00:00.000Z'),
        },
        {
          title: 'Hidden Recovery Draft',
          description: null,
          mode: 'active_recovery',
          isPublished: false,
          publishedAt: null,
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/workouts?mode=active_recovery',
        headers: {
          authorization: `Bearer ${signedIn.sessionToken}`,
        },
      });

      assert.equal(response.statusCode, 200);
      const body = response.json() as {
        workouts: Array<{
          id: string;
          title: string;
          description: string | null;
          mode: string;
          isPublished: boolean;
        }>;
      };

      assert.equal(body.workouts.length, 1);
      assert.deepEqual(body.workouts[0], {
        id: body.workouts[0]?.id,
        title: 'Walk 45',
        description: 'Low intensity recovery walk',
        mode: 'active_recovery',
        isPublished: true,
      });
      assert.deepEqual(body, {
        workouts: [
          {
            id: body.workouts[0]?.id,
            title: 'Walk 45',
            description: 'Low intensity recovery walk',
            mode: 'active_recovery',
            isPublished: true,
          },
        ],
      });
    } finally {
      await close();
    }
  });
});

test('DB-backed progress updates use last-write-wins conflict semantics', async () => {
  await withDbApp(async ({ app }) => {
    const signedIn = await signIn(app, 'google', 'http://localhost:3000/welcome');

    const firstUpdateResponse = await app.inject({
      method: 'PUT',
      url: '/users/me/progress',
      headers: {
        authorization: `Bearer ${signedIn.sessionToken}`,
      },
      payload: {
        streakDays: 2,
        completedWorkouts: 12,
        lastWorkoutAt: '2026-05-08T09:00:00.000Z',
      },
    });

    assert.equal(firstUpdateResponse.statusCode, 200);

    const secondUpdateResponse = await app.inject({
      method: 'PUT',
      url: '/users/me/progress',
      headers: {
        authorization: `Bearer ${signedIn.sessionToken}`,
      },
      payload: {
        streakDays: 6,
        completedWorkouts: 21,
        lastWorkoutAt: '2026-05-12T07:45:00.000Z',
      },
    });

    assert.equal(secondUpdateResponse.statusCode, 200);

    const persistedProgressResponse = await app.inject({
      method: 'GET',
      url: '/users/me/progress',
      headers: {
        authorization: `Bearer ${signedIn.sessionToken}`,
      },
    });

    assert.equal(persistedProgressResponse.statusCode, 200);
    assert.deepEqual(persistedProgressResponse.json(), {
      streakDays: 6,
      completedWorkouts: 21,
      lastWorkoutAt: '2026-05-12T07:45:00.000Z',
    });
  });
});

test('DB-backed notification registration dedupes by push token across users', async () => {
  await withDbApp(async ({ app }) => {
    const googleSession = await signIn(app, 'google', 'http://localhost:3000/welcome');
    const appleSession = await signIn(app, 'apple', 'http://localhost:3000/welcome');
    const sharedPushToken = `push-token-${randomUUID()}`;

    const firstRegistrationResponse = await app.inject({
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

    assert.equal(firstRegistrationResponse.statusCode, 200);

    const secondRegistrationResponse = await app.inject({
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

    assert.equal(secondRegistrationResponse.statusCode, 200);

    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for DB-backed device dedupe verification.');
    }

    const { db, close } = createDatabaseClient(env.DATABASE_URL);
    try {
      const rows = await db
        .select({
          userId: notificationDevices.userId,
          platform: notificationDevices.platform,
          pushToken: notificationDevices.pushToken,
        })
        .from(notificationDevices)
        .where(eq(notificationDevices.pushToken, sharedPushToken));

      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], {
        userId: appleSession.user.id,
        platform: 'android',
        pushToken: sharedPushToken,
      });
    } finally {
      await close();
    }
  });
});

test('DB-backed login streak is set to 1 on first sign-in and persists to Postgres', async () => {
  await withDbApp(async ({ app }) => {
    const signedIn = await signIn(app, 'google', 'http://localhost:3000/welcome');

    const progressGet = await app.inject({
      method: 'GET',
      url: '/users/me/progress',
      headers: { authorization: `Bearer ${signedIn.sessionToken}` },
    });

    assert.equal(progressGet.statusCode, 200);
    assert.equal(progressGet.json().streakDays, 1);
  });
});

test('DB-backed login streak is idempotent when updateStreakOnLogin is called twice on the same day', async () => {
  await withDbApp(async ({ app, store }) => {
    const signedIn = await signIn(app, 'google', 'http://localhost:3000/welcome');
    // Use a past date safely distant from today to avoid consecutive-day false positives
    const sameDay = new Date('2020-01-15T12:00:00Z');

    await store.updateStreakOnLogin(signedIn.user.id, sameDay);
    await store.updateStreakOnLogin(signedIn.user.id, sameDay);

    const progressGet = await app.inject({
      method: 'GET',
      url: '/users/me/progress',
      headers: { authorization: `Bearer ${signedIn.sessionToken}` },
    });

    assert.equal(progressGet.statusCode, 200);
    assert.equal(progressGet.json().streakDays, 1);
  });
});
