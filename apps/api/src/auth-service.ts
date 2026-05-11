import { authSessions, oauthTransactions } from '@3plates/db';
import { createDatabaseClient } from '@3plates/db';
import { and, eq } from 'drizzle-orm';
import {
  createHash,
  randomBytes,
  randomUUID,
  createPrivateKey,
} from 'node:crypto';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { isNull } from 'drizzle-orm';

import { env } from './env.js';
import type { AuthProviderName, AuthTransactionPurpose, OAuthIdentity, OAuthProviderAdapter } from './auth-types.js';
import type { UserRecord, UserStateStore } from './user-state-store.js';

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

export interface AuthRepository {
  createOAuthTransaction(input: OAuthTransaction): Promise<void>;
  consumeOAuthTransaction(state: string): Promise<OAuthTransaction | null>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  getSessionByToken(token: string): Promise<{ userId: string; expiresAt: Date } | null>;
  revokeSessionByToken(token: string): Promise<void>;
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
  }): Promise<{ sessionToken: string; expiresAt: string; user: UserRecord; redirectTo: string | null }>;
  refreshSession(token: string): Promise<{ sessionToken: string; expiresAt: string; user: UserRecord } | null>;
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

      return transaction;
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

    close,
  };
}

export function createMemoryAuthRepository(): AuthRepository {
  const transactions = new Map<string, OAuthTransaction>();
  const sessions = new Map<string, { userId: string; expiresAt: Date; revokedAt: Date | null }>();

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
  const clientSecret = env.AUTH_APPLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('AUTH_APPLE_CLIENT_ID and AUTH_APPLE_CLIENT_SECRET are required for Apple OAuth.');
  }

  return {
    provider: 'apple',
    buildAuthorizationUrl({ redirectUri, state, codeChallenge }) {
      const url = new URL('https://appleid.apple.com/auth/authorize');
      url.searchParams.set('client_id', clientId);
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
      const response = await fetch('https://appleid.apple.com/auth/token', {
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
}) : AuthService {
  const sessionTtlMilliseconds = env.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

  return {
    async startAuthentication({ provider, purpose, redirectTo, userId, callbackUrl }) {
      const codeVerifier = buildCodeVerifier();
      const state = randomUUID();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await input.authRepository.createOAuthTransaction({
        state,
        provider,
        purpose,
        userId: userId ?? null,
        redirectTo: redirectTo ?? null,
        codeVerifier,
        expiresAt,
      });

      const next = input.providers[provider].buildAuthorizationUrl({
        redirectUri: callbackUrl,
        state,
        codeChallenge: buildCodeChallenge(codeVerifier),
      });

      return { next, state, provider };
    },

    async completeAuthentication({ provider, code, state, callbackUrl }) {
      const transaction = await input.authRepository.consumeOAuthTransaction(state);
      if (!transaction) {
        throw new Error('OAuth transaction is missing or expired.');
      }

      if (transaction.provider !== provider) {
        throw new Error('OAuth transaction provider mismatch.');
      }

      if (transaction.expiresAt.getTime() <= Date.now()) {
        throw new Error('OAuth transaction has expired.');
      }

      const identity = await input.providers[provider].exchangeCode({
        code,
        redirectUri: callbackUrl,
        codeVerifier: transaction.codeVerifier,
      });

      const user = await input.userStateStore.resolveOAuthIdentity({
        ...identity,
        linkedUserId: transaction.purpose === 'link' ? transaction.userId : null,
      });

      const sessionToken = buildSessionToken();
      const expiresAt = new Date(Date.now() + sessionTtlMilliseconds);
      await input.authRepository.createSession(user.id, hashToken(sessionToken), expiresAt);

      return {
        sessionToken,
        expiresAt: expiresAt.toISOString(),
        user,
        redirectTo: transaction.redirectTo,
      };
    },

    async refreshSession(token) {
      const session = await input.authRepository.getSessionByToken(token);
      if (!session) {
        return null;
      }

      await input.authRepository.revokeSessionByToken(token);

      const user = await input.userStateStore.getUserById(session.userId);
      if (!user) {
        return null;
      }

      const sessionToken = buildSessionToken();
      const expiresAt = new Date(Date.now() + sessionTtlMilliseconds);
      await input.authRepository.createSession(user.id, hashToken(sessionToken), expiresAt);

      return {
        sessionToken,
        expiresAt: expiresAt.toISOString(),
        user,
      };
    },

    async resolveRequestUser(token) {
      const session = await input.authRepository.getSessionByToken(token);
      if (!session) {
        return null;
      }

      if (session.expiresAt.getTime() <= Date.now()) {
        return null;
      }

      return input.userStateStore.getUserById(session.userId);
    },
  };
}
