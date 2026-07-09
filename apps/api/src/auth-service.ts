import { authSessions, createDatabaseClient, mobileAuthExchanges, oauthTransactions } from '@3plates/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { jwtVerify, createRemoteJWKSet, importPKCS8, SignJWT } from 'jose';

import { conflictOrStaleUpdateError, missingUserStateError } from './api-error.js';
import { env } from './env.js';
import type { AuthProviderName, AuthTransactionPurpose, OAuthIdentity, OAuthProviderAdapter } from './auth-types.js';
import type { UserRecord, UserStateStore } from './user-state-store.js';

const oauthTransactionTtlMilliseconds = 10 * 60 * 1000;
const mobileExchangeTtlMilliseconds = 2 * 60 * 1000;

export type OAuthTransaction = {
  state: string;
  provider: AuthProviderName;
  purpose: AuthTransactionPurpose;
  userId: string | null;
  redirectTo: string | null;
  codeVerifier: string;
  expiresAt: Date;
};

export type AuthSession = {
  userId: string;
  token: string;
  expiresAt: Date;
};

export type MobileAuthExchangeRecord = {
  code: string;
  sessionToken: string;
  sessionExpiresAt: Date;
  user: UserRecord;
  isNewUser: boolean;
  effectiveLevel: number;
  exchangeExpiresAt: Date;
};

export interface AuthRepository {
  createOAuthTransaction(input: OAuthTransaction): Promise<void>;
  consumeOAuthTransaction(state: string): Promise<OAuthTransaction | null>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  getSessionByToken(token: string): Promise<{ userId: string; expiresAt: Date } | null>;
  revokeSessionByToken(token: string): Promise<void>;
  createMobileAuthExchange(input: MobileAuthExchangeRecord): Promise<void>;
  consumeMobileAuthExchange(code: string): Promise<MobileAuthExchangeRecord | null>;
  close?(): Promise<void>;
}

export type AuthService = {
  startAuthentication(input: {
    provider: AuthProviderName;
    purpose: AuthTransactionPurpose;
    redirectTo?: string | null;
    userId?: string | null;
    callbackUrl: string;
  }): Promise<{ next: string; state: string; provider: AuthProviderName }>;
  completeAuthentication(input: {
    provider: AuthProviderName;
    code: string;
    state: string;
    callbackUrl: string;
  }): Promise<{
    sessionToken: string;
    expiresAt: string;
    user: UserRecord;
    isNewUser: boolean;
    effectiveLevel: number;
    redirectTo: string | null;
  }>;
  issueMobileAuthExchangeCode(input: {
    sessionToken: string;
    expiresAt: string;
    user: UserRecord;
    isNewUser: boolean;
    effectiveLevel: number;
  }): Promise<{ code: string; exchangeExpiresAt: string }>;
  redeemMobileAuthExchangeCode(code: string): Promise<{
    sessionToken: string;
    expiresAt: string;
    user: UserRecord;
    isNewUser: boolean;
    effectiveLevel: number;
  } | null>;
  refreshSession(token: string): Promise<{
    sessionToken: string;
    expiresAt: string;
    user: UserRecord;
    isNewUser: boolean;
    effectiveLevel: number;
  } | null>;
  signOut(token: string): Promise<boolean>;
  resolveRequestUser(token: string): Promise<UserRecord | null>;
};

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function buildCodeVerifier() {
  return randomBytes(32).toString('base64url');
}

function buildCodeChallenge(codeVerifier: string) {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

function buildSessionToken() {
  return randomBytes(32).toString('base64url');
}

function parseEmailVerified(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return false;
}

function normalizeEmail(email: string | null | undefined) {
  return email ? email.trim().toLowerCase() : null;
}

export function createDbAuthRepository(connectionString: string): AuthRepository {
  const { db, close } = createDatabaseClient(connectionString);

  return {
    async createOAuthTransaction(input) {
      await db.insert(oauthTransactions).values({
        state: input.state,
        provider: input.provider,
        purpose: input.purpose,
        userId: input.userId,
        redirectTo: input.redirectTo,
        codeVerifier: input.codeVerifier,
        expiresAt: input.expiresAt,
      });
    },

    async consumeOAuthTransaction(state) {
      const [transaction] = await db
        .select({
          state: oauthTransactions.state,
          provider: oauthTransactions.provider,
          purpose: oauthTransactions.purpose,
          userId: oauthTransactions.userId,
          redirectTo: oauthTransactions.redirectTo,
          codeVerifier: oauthTransactions.codeVerifier,
          expiresAt: oauthTransactions.expiresAt,
        })
        .from(oauthTransactions)
        .where(eq(oauthTransactions.state, state))
        .limit(1);

      if (!transaction) {
        return null;
      }

      await db.delete(oauthTransactions).where(eq(oauthTransactions.state, state));

      return {
        ...transaction,
        provider: transaction.provider as AuthProviderName,
        purpose: transaction.purpose as AuthTransactionPurpose,
      };
    },

    async createSession(userId, tokenHash, expiresAt) {
      await db.insert(authSessions).values({
        userId,
        tokenHash,
        expiresAt,
      });
    },

    async getSessionByToken(token) {
      const tokenHash = hashToken(token);
      const [session] = await db
        .select({
          userId: authSessions.userId,
          expiresAt: authSessions.expiresAt,
        })
        .from(authSessions)
        .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)))
        .limit(1);

      if (!session) {
        return null;
      }

      return session;
    },

    async revokeSessionByToken(token) {
      const tokenHash = hashToken(token);
      await db
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(eq(authSessions.tokenHash, tokenHash));
    },

    async createMobileAuthExchange(input) {
      await db.insert(mobileAuthExchanges).values({
        code: input.code,
        sessionToken: input.sessionToken,
        sessionExpiresAt: input.sessionExpiresAt,
        userId: input.user.id,
        userEmail: input.user.email,
        userDisplayName: input.user.displayName,
        isNewUser: input.isNewUser,
        effectiveLevel: input.effectiveLevel,
        exchangeExpiresAt: input.exchangeExpiresAt,
      });
    },

    async consumeMobileAuthExchange(code) {
      const now = new Date();
      const [exchange] = await db
        .delete(mobileAuthExchanges)
        .where(and(eq(mobileAuthExchanges.code, code), gt(mobileAuthExchanges.exchangeExpiresAt, now)))
        .returning({
          code: mobileAuthExchanges.code,
          sessionToken: mobileAuthExchanges.sessionToken,
          sessionExpiresAt: mobileAuthExchanges.sessionExpiresAt,
          userId: mobileAuthExchanges.userId,
          userEmail: mobileAuthExchanges.userEmail,
          userDisplayName: mobileAuthExchanges.userDisplayName,
          isNewUser: mobileAuthExchanges.isNewUser,
          effectiveLevel: mobileAuthExchanges.effectiveLevel,
          exchangeExpiresAt: mobileAuthExchanges.exchangeExpiresAt,
        });

      if (!exchange) {
        return null;
      }

      return {
        code: exchange.code,
        sessionToken: exchange.sessionToken,
        sessionExpiresAt: exchange.sessionExpiresAt,
        isNewUser: exchange.isNewUser,
        effectiveLevel: exchange.effectiveLevel,
        exchangeExpiresAt: exchange.exchangeExpiresAt,
        user: {
          id: exchange.userId,
          email: exchange.userEmail,
          displayName: exchange.userDisplayName,
        },
      };
    },

    close,
  };
}

export function createMemoryAuthRepository(): AuthRepository {
  const transactions = new Map<string, OAuthTransaction>();
  const sessions = new Map<string, { userId: string; expiresAt: Date; revokedAt: Date | null }>();
  const mobileExchanges = new Map<string, MobileAuthExchangeRecord>();

  function pruneExpiredMobileExchanges() {
    const now = Date.now();
    for (const [code, exchange] of mobileExchanges.entries()) {
      if (exchange.exchangeExpiresAt.getTime() <= now) {
        mobileExchanges.delete(code);
      }
    }
  }

  return {
    async createOAuthTransaction(input) {
      transactions.set(input.state, input);
    },

    async consumeOAuthTransaction(state) {
      const transaction = transactions.get(state) ?? null;
      transactions.delete(state);
      return transaction;
    },

    async createSession(userId, tokenHash, expiresAt) {
      sessions.set(tokenHash, { userId, expiresAt, revokedAt: null });
    },

    async getSessionByToken(token) {
      const tokenHash = hashToken(token);
      const session = sessions.get(tokenHash);
      if (!session || session.revokedAt) {
        return null;
      }

      return { userId: session.userId, expiresAt: session.expiresAt };
    },

    async revokeSessionByToken(token) {
      const tokenHash = hashToken(token);
      const session = sessions.get(tokenHash);
      if (session) {
        session.revokedAt = new Date();
      }
    },

    async createMobileAuthExchange(input) {
      pruneExpiredMobileExchanges();
      mobileExchanges.set(input.code, input);
    },

    async consumeMobileAuthExchange(code) {
      pruneExpiredMobileExchanges();
      const exchange = mobileExchanges.get(code) ?? null;
      if (!exchange) {
        return null;
      }

      mobileExchanges.delete(code);
      return exchange;
    },

    async close() {
      return undefined;
    },
  };
}

async function verifyOidcIdToken(input: {
  idToken: string;
  issuer: string;
  audience: string;
  jwksUrl: string;
}) {
  const JWKS = createRemoteJWKSet(new URL(input.jwksUrl));
  const { payload } = await jwtVerify(input.idToken, JWKS, {
    issuer: input.issuer,
    audience: input.audience,
  });

  return payload;
}

export function createGoogleOAuthProvider(): OAuthProviderAdapter {
  const clientId = env.AUTH_GOOGLE_CLIENT_ID;
  const clientSecret = env.AUTH_GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET are required for Google OAuth.');
  }

  return {
    provider: 'google',
    buildAuthorizationUrl({ redirectUri, state, codeChallenge }) {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      return url.toString();
    },
    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        throw new Error('Google token exchange failed.');
      }

      const tokenResponse = (await response.json()) as { id_token?: string };
      if (!tokenResponse.id_token) {
        throw new Error('Google token response did not include an id_token.');
      }

      const payload = await verifyOidcIdToken({
        idToken: tokenResponse.id_token,
        issuer: 'https://accounts.google.com',
        audience: clientId,
        jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
      });

      return {
        provider: 'google',
        providerSubjectId: String(payload.sub),
        email: normalizeEmail(typeof payload.email === 'string' ? payload.email : null),
        emailVerified: parseEmailVerified(payload.email_verified),
        displayName: typeof payload.name === 'string' ? payload.name : null,
      };
    },
  };
}

export function createAppleOAuthProvider(): OAuthProviderAdapter {
  const clientId = env.AUTH_APPLE_CLIENT_ID;
  let generatedClientSecret: { value: Promise<string>; refreshAfterMilliseconds: number } | null = null;

  if (!clientId) {
    throw new Error('AUTH_APPLE_CLIENT_ID is required for Apple OAuth.');
  }

  const appleClientId = clientId;

  async function loadApplePrivateKey() {
    if (env.AUTH_APPLE_PRIVATE_KEY) {
      return env.AUTH_APPLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    }

    if (env.AUTH_APPLE_PRIVATE_KEY_PATH) {
      return readFile(env.AUTH_APPLE_PRIVATE_KEY_PATH, 'utf8');
    }

    return null;
  }

  async function getClientSecret() {
    const privateKey = await loadApplePrivateKey();

    if (!env.AUTH_APPLE_TEAM_ID || !env.AUTH_APPLE_KEY_ID || !privateKey) {
      throw new Error(
        'AUTH_APPLE_TEAM_ID, AUTH_APPLE_KEY_ID, and AUTH_APPLE_PRIVATE_KEY or AUTH_APPLE_PRIVATE_KEY_PATH are required for Apple OAuth.',
      );
    }

    if (generatedClientSecret && generatedClientSecret.refreshAfterMilliseconds > Date.now()) {
      return generatedClientSecret.value;
    }

    const teamId = env.AUTH_APPLE_TEAM_ID;
    const keyId = env.AUTH_APPLE_KEY_ID;
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = issuedAtSeconds + 24 * 60 * 60;

    generatedClientSecret = {
      refreshAfterMilliseconds: (expiresAtSeconds - 5 * 60) * 1000,
      value: (async () => {
        const key = await importPKCS8(privateKey, 'ES256');

        return new SignJWT({})
          .setProtectedHeader({ alg: 'ES256', kid: keyId })
          .setIssuer(teamId)
          .setSubject(appleClientId)
          .setAudience('https://appleid.apple.com')
          .setIssuedAt(issuedAtSeconds)
          .setExpirationTime(expiresAtSeconds)
          .sign(key);
      })(),
    };

    return generatedClientSecret.value;
  }

  return {
    provider: 'apple',
    buildAuthorizationUrl({ redirectUri, state, codeChallenge }) {
      const url = new URL('https://appleid.apple.com/auth/authorize');
      url.searchParams.set('client_id', appleClientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('response_mode', 'query');
      url.searchParams.set('scope', 'name email');
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return url.toString();
    },
    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const clientSecret = await getClientSecret();
      const response = await fetch('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: appleClientId,
          client_secret: clientSecret,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        throw new Error('Apple token exchange failed.');
      }

      const tokenResponse = (await response.json()) as { id_token?: string };
      if (!tokenResponse.id_token) {
        throw new Error('Apple token response did not include an id_token.');
      }

      const payload = await verifyOidcIdToken({
        idToken: tokenResponse.id_token,
        issuer: 'https://appleid.apple.com',
        audience: clientId,
        jwksUrl: 'https://appleid.apple.com/auth/keys',
      });

      return {
        provider: 'apple',
        providerSubjectId: String(payload.sub),
        email: normalizeEmail(typeof payload.email === 'string' ? payload.email : null),
        emailVerified: parseEmailVerified(payload.email_verified),
        displayName: typeof payload.name === 'string' ? payload.name : null,
      };
    },
  };
}

export function createAuthService(input: {
  authRepository: AuthRepository;
  userStateStore: UserStateStore;
  providers: Record<AuthProviderName, OAuthProviderAdapter>;
}): AuthService {
  const { authRepository, providers, userStateStore } = input;
  const sessionTtlMilliseconds = env.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

  async function issueSession(userId: string) {
    const sessionToken = buildSessionToken();
    const expiresAt = new Date(Date.now() + sessionTtlMilliseconds);
    await authRepository.createSession(userId, hashToken(sessionToken), expiresAt);

    return {
      sessionToken,
      expiresAt,
    };
  }

  return {
    async startAuthentication({ provider, purpose, redirectTo, userId, callbackUrl }) {
      const codeVerifier = buildCodeVerifier();
      const state = randomUUID();
      const expiresAt = new Date(Date.now() + oauthTransactionTtlMilliseconds);

      await authRepository.createOAuthTransaction({
        state,
        provider,
        purpose,
        userId: userId ?? null,
        redirectTo: redirectTo ?? null,
        codeVerifier,
        expiresAt,
      });

      const next = providers[provider].buildAuthorizationUrl({
        redirectUri: callbackUrl,
        state,
        codeChallenge: buildCodeChallenge(codeVerifier),
      });

      return { next, state, provider };
    },

    async completeAuthentication({ provider, code, state, callbackUrl }) {
      const transaction = await authRepository.consumeOAuthTransaction(state);
      if (!transaction) {
        throw conflictOrStaleUpdateError('OAuth transaction is missing or expired.');
      }

      if (transaction.provider !== provider) {
        throw conflictOrStaleUpdateError('OAuth transaction provider mismatch.');
      }

      if (transaction.expiresAt.getTime() <= Date.now()) {
        throw conflictOrStaleUpdateError('OAuth transaction has expired.');
      }

      const identity = await providers[provider].exchangeCode({
        code,
        redirectUri: callbackUrl,
        codeVerifier: transaction.codeVerifier,
      });

      const resolved = await userStateStore.resolveOAuthIdentity({
        ...identity,
        linkedUserId: transaction.purpose === 'link' ? transaction.userId : null,
      });

      await userStateStore.updateStreakOnLogin(resolved.user.id, new Date());
      const session = await issueSession(resolved.user.id);

      return {
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt.toISOString(),
        user: resolved.user,
        isNewUser: resolved.isNewUser,
        effectiveLevel: resolved.effectiveLevel,
        redirectTo: transaction.redirectTo,
      };
    },

    async issueMobileAuthExchangeCode({ sessionToken, expiresAt, user, isNewUser, effectiveLevel }) {
      const exchangeCode = randomUUID();
      const exchangeExpiresAt = new Date(Date.now() + mobileExchangeTtlMilliseconds);
      const sessionExpiresAt = new Date(expiresAt);

      await authRepository.createMobileAuthExchange({
        code: exchangeCode,
        sessionToken,
        sessionExpiresAt,
        user,
        isNewUser,
        effectiveLevel,
        exchangeExpiresAt,
      });

      return {
        code: exchangeCode,
        exchangeExpiresAt: exchangeExpiresAt.toISOString(),
      };
    },

    async redeemMobileAuthExchangeCode(code) {
      const exchange = await authRepository.consumeMobileAuthExchange(code);
      if (!exchange) {
        return null;
      }

      return {
        sessionToken: exchange.sessionToken,
        expiresAt: exchange.sessionExpiresAt.toISOString(),
        user: exchange.user,
        isNewUser: exchange.isNewUser,
        effectiveLevel: exchange.effectiveLevel,
      };
    },

    async refreshSession(token) {
      const session = await authRepository.getSessionByToken(token);
      if (!session) {
        return null;
      }

      if (session.expiresAt.getTime() <= Date.now()) {
        await authRepository.revokeSessionByToken(token);
        return null;
      }

      await authRepository.revokeSessionByToken(token);

      const user = await userStateStore.getUserById(session.userId);
      if (!user) {
        throw missingUserStateError('Session belongs to a deleted user.');
      }
      const effectiveLevel = await userStateStore.getUserEffectiveLevel(user.id);

      const refreshedSession = await issueSession(user.id);

      return {
        sessionToken: refreshedSession.sessionToken,
        expiresAt: refreshedSession.expiresAt.toISOString(),
        user,
        isNewUser: false,
        effectiveLevel,
      };
    },

    async signOut(token) {
      const session = await authRepository.getSessionByToken(token);
      if (!session) {
        return false;
      }

      await authRepository.revokeSessionByToken(token);

      return session.expiresAt.getTime() > Date.now();
    },

    async resolveRequestUser(token) {
      const session = await authRepository.getSessionByToken(token);
      if (!session) {
        return null;
      }

      if (session.expiresAt.getTime() <= Date.now()) {
        return null;
      }

      const user = await userStateStore.getUserById(session.userId);
      if (!user) {
        throw missingUserStateError('Session belongs to a deleted user.');
      }

      return user;
    },
  };
}
