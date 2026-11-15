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

// Exercise the same revocation interleavings against both repository adapters.
export async function assertUnlinkInvalidatesAuthentication(
  context: ReturnType<typeof createTestAuthApp>,
  phase: 'pending-link' | 'consumed-link' | 'resolved-login',
) {
  const { app, store, authRepository, appleProfile } = context;
  const session = await signIn(app, 'google');
  await store.resolveOAuthIdentity({ ...appleProfile, linkedUserId: session.user.id });
  const start = await app.inject({ method: 'POST', url: phase === 'resolved-login' ? '/auth/start' : '/auth/link',
    headers: { authorization: `Bearer ${session.sessionToken}` }, payload: { provider: 'apple' } });
  assert.equal(start.statusCode, 200);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const resolveIdentity = store.resolveOAuthIdentity.bind(store);
  const createSession = authRepository.createSession.bind(authRepository);
  if (phase === 'consumed-link') store.resolveOAuthIdentity = async (input) => {
    entered(); await waiting; return resolveIdentity(input);
  };
  if (phase === 'resolved-login') authRepository.createSession = async (...args) => {
    entered(); await waiting; return createSession(...args);
  };
  const callback = () => app.inject({ method: 'GET', url: `/auth/callback?provider=apple&code=test&state=${start.json().state}` });
  try {
    const pending = phase === 'pending-link' ? null : callback();
    if (pending) await started;
    await store.unlinkIdentity(session.user.id, 'apple');
    release();
    const result = await (pending ?? callback());
    assert.ok(result.statusCode >= 400 && result.statusCode < 500, result.body);
    assert.deepEqual((await store.listIdentities(session.user.id)).map((identity) => identity.provider), ['google']);
    assert.equal(await store.getAuthenticationGeneration(session.user.id), 1);
    const revoked = await app.inject({ method: 'GET', url: '/users/me', headers: { authorization: `Bearer ${session.sessionToken}` } });
    assert.equal(revoked.statusCode, 401);
  } finally {
    release(); store.resolveOAuthIdentity = resolveIdentity; authRepository.createSession = createSession;
  }
  const fresh = await signIn(app, 'google');
  assert.equal(fresh.user.id, session.user.id);
  const me = await app.inject({ method: 'GET', url: '/users/me', headers: { authorization: `Bearer ${fresh.sessionToken}` } });
  assert.equal(me.statusCode, 200);
}
