import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createAuthService } from './auth-service.js';
import type { AuthRepository } from './auth-service.js';
import type { AuthProviderName, OAuthIdentity, OAuthProviderAdapter } from './auth-types.js';
import { createServer } from './server.js';
import type { UserRecord, UserStateStore } from './user-state-store.js';

const defaultRedirectTo = 'http://localhost:3000/welcome';

export type SignInResult = {
  ok: true;
  provider: AuthProviderName;
  sessionToken: string;
  expiresAt: string;
  user: UserRecord;
  isNewUser: boolean;
  effectiveLevel: number;
  redirectTo: string | null;
};

export function createFakeProvider(
  provider: AuthProviderName,
  profile: OAuthIdentity,
): OAuthProviderAdapter {
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

function createOAuthProfile(provider: AuthProviderName, label: string): OAuthIdentity {
  return {
    provider,
    providerSubjectId: `${provider}-${randomUUID()}`,
    email: `${provider}-${randomUUID()}@example.com`,
    emailVerified: true,
    displayName: `${label} User`,
  };
}

export function createTestAuthApp<TStore extends UserStateStore>(input: {
  store: TStore;
  authRepository: AuthRepository;
  googleProfile?: OAuthIdentity;
  appleProfile?: OAuthIdentity;
  displayNamePrefix?: string;
}) {
  const profilePrefix = input.displayNamePrefix ?? 'Test';
  const googleProfile = input.googleProfile ?? createOAuthProfile('google', `Google ${profilePrefix}`);
  const appleProfile = input.appleProfile ?? createOAuthProfile('apple', `Apple ${profilePrefix}`);

  const authService = createAuthService({
    authRepository: input.authRepository,
    userStateStore: input.store,
    providers: {
      google: createFakeProvider('google', googleProfile),
      apple: createFakeProvider('apple', appleProfile),
    },
  });

  return {
    app: createServer({ store: input.store, authService }),
    authRepository: input.authRepository,
    store: input.store,
    googleProfile,
    appleProfile,
  };
}

export async function signIn(
  app: ReturnType<typeof createTestAuthApp>['app'],
  provider: AuthProviderName,
  redirectTo = defaultRedirectTo,
): Promise<SignInResult> {
  const startResponse = await app.inject({
    method: 'POST',
    url: '/auth/start',
    payload: {
      provider,
      redirectTo,
    },
  });

  assert.equal(startResponse.statusCode, 200);
  const startBody = startResponse.json() as { state: string };

  const callbackUrl = new URL('/auth/callback', 'http://localhost');
  callbackUrl.searchParams.set('provider', provider);
  callbackUrl.searchParams.set('code', `${provider}-code`);
  callbackUrl.searchParams.set('state', startBody.state);

  const callbackResponse = await app.inject({
    method: 'GET',
    url: `${callbackUrl.pathname}${callbackUrl.search}`,
  });

  assert.equal(callbackResponse.statusCode, 200);
  return callbackResponse.json() as SignInResult;
}

export function assertApiError(body: unknown, code: string, message: string) {
  assert.deepEqual(body, {
    ok: false,
    error: {
      code,
      message,
    },
  });
}
