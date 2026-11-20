import { authExchangeChallengeSchema, authExchangeVerifierSchema } from '@3plates/contract';
import { authSessions, createDatabaseClient, mobileAuthExchanges, oauthTransactions, userIdentities, users } from '@3plates/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { jwtVerify, createRemoteJWKSet, importPKCS8, SignJWT } from 'jose';

import { conflictOrStaleUpdateError, missingUserStateError } from './api-error.js';
import { requiresExchangeHandoff } from './auth-redirect.js';
import { lockActiveLinkSession, type LinkSession } from './auth-session.js';
import { env } from './env.js';
import type { AuthProviderName, AuthTransactionPurpose, OAuthIdentity, OAuthProviderAdapter } from './auth-types.js';
import type { UserRecord, UserStateStore } from './user-state-store.js';

const oauthTransactionTtlMilliseconds = 10 * 60 * 1000;
const mobileExchangeTtlMilliseconds = 2 * 60 * 1000;
const appleClientSecretTtlSeconds = 24 * 60 * 60;
const appleClientSecretRefreshSkewSeconds = 5 * 60;

export type OAuthTransaction = {
  state: string;
  provider: AuthProviderName;
  purpose: AuthTransactionPurpose;
  authGeneration?: number | null;
  initiatingSessionHash?: string | null;
  userId: string | null;
  redirectTo: string | null;
  codeVerifier: string;
  exchangeChallenge?: string | null;
  expiresAt: Date;
};

export type AuthSession = {
  userId: string;
  token: string;
  expiresAt: Date;
};

export type MobileAuthExchangeRecord = {
  exchangeChallenge: string | null;
  code: string;
  sessionToken: string;
  sessionExpiresAt: Date;
  user: UserRecord;
  isNewUser: boolean;
  effectiveLevel: number;
  exchangeExpiresAt: Date;
};

type SessionAuthorization = { generation: number; provider: string; subject: string; linkSession?: LinkSession };
export interface AuthRepository {
  createOAuthTransaction(input: OAuthTransaction): Promise<void>;
  isMemoryLinkSessionActive?(userId: string, session: LinkSession): boolean;
  consumeOAuthTransaction(state: string): Promise<OAuthTransaction | null>;
  createSession(userId: string, tokenHash: string, expiresAt: Date, authorization?: SessionAuthorization): Promise<void>;
  rotateSession(token: string, nextHash: string, expiresAt: Date): Promise<string | null>;
  revokeUserSessions(userId: string): Promise<void>;
  getSessionByToken(token: string): Promise<{ userId: string; expiresAt: Date; authGeneration: number } | null>;
  revokeSessionByToken(token: string, options?: { cancelPendingLinks: boolean }): Promise<void>;
  createMobileAuthExchange(input: MobileAuthExchangeRecord): Promise<void>;
  consumeMobileAuthExchange(code: string, exchangeChallenge: string): Promise<MobileAuthExchangeRecord | null>;
  close?(): Promise<void>;
}

export type AuthService = {
  close?(): Promise<void>;
  startAuthentication(input: {
    provider: AuthProviderName;
    purpose: AuthTransactionPurpose;
    redirectTo?: string | null;
    exchangeChallenge?: string | null;
    userId?: string | null;
    initiatingToken?: string | null;
    callbackUrl: string;
  }): Promise<{ next: string; state: string; provider: AuthProviderName }>;
  completeAuthentication(input: {
    provider?: AuthProviderName | null;
    code: string;
    state: string;
    callbackUrl: string;
  }): Promise<{
    provider: AuthProviderName;
    sessionToken: string;
    expiresAt: string;
    user: UserRecord;
    isNewUser: boolean;
    effectiveLevel: number;
    redirectTo: string | null;
    exchangeChallenge: string | null;
  }>;
  issueMobileAuthExchangeCode(input: {
    exchangeChallenge: string;
    sessionToken: string;
    expiresAt: string;
    user: UserRecord;
    isNewUser: boolean;
    effectiveLevel: number;
  }): Promise<{ code: string; exchangeExpiresAt: string }>;
  redeemMobileAuthExchangeCode(code: string, verifier: string): Promise<{
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

function readLinkSession(transaction: OAuthTransaction): LinkSession {
  if (!transaction.initiatingSessionHash || typeof transaction.authGeneration !== 'number') {
    throw conflictOrStaleUpdateError('Start linking again.');
  }
  return { tokenHash: transaction.initiatingSessionHash, generation: transaction.authGeneration };
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
      await db.transaction(async (tx) => {
        if (input.purpose === 'link') {
          const userId = input.userId;
          const linkSession = readLinkSession(input);
          if (!userId) throw missingUserStateError('Sign in before linking another provider.');
          const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
          if (!user || user.deletionRequestedAt || user.authGeneration !== linkSession.generation ||
              !await lockActiveLinkSession(tx, userId, linkSession)) {
            throw conflictOrStaleUpdateError('Account authentication changed. Start linking again.');
          }
        }
        await tx.insert(oauthTransactions).values(input);
      });
    },

    async consumeOAuthTransaction(state) {
      // DELETE RETURNING makes the one-time state claim atomic across requests.
      const [transaction] = await db
        .delete(oauthTransactions)
        .where(eq(oauthTransactions.state, state))
        .returning();

      if (!transaction) {
        return null;
      }

      return {
        ...transaction,
        provider: transaction.provider as AuthProviderName,
        purpose: transaction.purpose as AuthTransactionPurpose,
      };
    },

    async createSession(userId, tokenHash, expiresAt, authorization) {
      await db.transaction(async (tx) => {
        const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
        if (!user || user.deletionRequestedAt) throw missingUserStateError();
        if (authorization) {
          const [identity] = await tx.select().from(userIdentities).where(and(eq(userIdentities.userId, userId), eq(userIdentities.provider, authorization.provider), eq(userIdentities.providerSubjectId, authorization.subject)));
          if (!identity || user.authGeneration !== authorization.generation) throw conflictOrStaleUpdateError('Account authentication changed. Sign in again.');
          if (authorization.linkSession && !await lockActiveLinkSession(tx, userId, authorization.linkSession)) {
            throw conflictOrStaleUpdateError('Account authentication changed. Start linking again.');
          }
        }
        await tx.insert(authSessions).values({ userId, tokenHash, expiresAt, authGeneration: authorization?.generation ?? user.authGeneration });
      });
    },

    async rotateSession(token, nextHash, expiresAt) {
      return db.transaction(async (tx) => {
        const [candidate] = await tx.select({ userId: authSessions.userId, authGeneration: authSessions.authGeneration }).from(authSessions).where(eq(authSessions.tokenHash, hashToken(token)));
        if (!candidate) return null;
        const [user] = await tx.select().from(users).where(eq(users.id, candidate.userId)).for('update');
        if (!user || user.deletionRequestedAt || user.authGeneration !== candidate.authGeneration) return null;
        const [consumed] = await tx.update(authSessions).set({ revokedAt: new Date() })
          .where(and(eq(authSessions.tokenHash, hashToken(token)), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date())))
          .returning({ userId: authSessions.userId });
        if (!consumed) return null;
        await tx.insert(authSessions).values({ userId: consumed.userId, tokenHash: nextHash, expiresAt, authGeneration: user.authGeneration });
        return consumed.userId;
      });
    },
    async revokeUserSessions(userId) {
      await db.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.userId, userId));
    },

    async getSessionByToken(token) {
      const tokenHash = hashToken(token);
      const [session] = await db
        .select({
          userId: authSessions.userId,
          expiresAt: authSessions.expiresAt,
          authGeneration: authSessions.authGeneration,
        })
        .from(authSessions)
        .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)))
        .limit(1);

      if (!session) {
        return null;
      }

      return session;
    },

    async revokeSessionByToken(token, options) {
      await db.transaction(async (transaction) => {
        const tokenHash = hashToken(token);
        if (options?.cancelPendingLinks) {
          const [session] = await transaction.select({ owner: authSessions.userId })
            .from(authSessions).where(eq(authSessions.tokenHash, tokenHash));
          if (!session) return;
          // Keep the same user-before-session lock order as linking and rotation.
          await transaction.select({ id: users.id }).from(users).where(eq(users.id, session.owner)).for('update');
        }
        const revoked = await transaction.update(authSessions)
          .set({ revokedAt: new Date() })
          .where(eq(authSessions.tokenHash, tokenHash))
          .returning({ owner: authSessions.userId });
        if (options?.cancelPendingLinks && revoked.length) {
          await transaction.delete(oauthTransactions).where(and(
            eq(oauthTransactions.userId, revoked[0].owner),
            eq(oauthTransactions.purpose, 'link'),
          ));
        }
      });
    },

    async createMobileAuthExchange(input) {
      await db.insert(mobileAuthExchanges).values({
        code: input.code,
        exchangeChallenge: input.exchangeChallenge,
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

    async consumeMobileAuthExchange(code, exchangeChallenge) {
      const now = new Date();
      const [exchange] = await db
        .delete(mobileAuthExchanges)
        .where(and(eq(mobileAuthExchanges.code, code), eq(mobileAuthExchanges.exchangeChallenge, exchangeChallenge), gt(mobileAuthExchanges.exchangeExpiresAt, now)))
        .returning({
          code: mobileAuthExchanges.code,
          exchangeChallenge: mobileAuthExchanges.exchangeChallenge,
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
        exchangeChallenge: exchange.exchangeChallenge,
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
  const sessions = new Map<string, { userId: string; expiresAt: Date; revokedAt: Date | null; authGeneration: number }>();
  const mobileExchanges = new Map<string, MobileAuthExchangeRecord>();

  function isMemoryLinkSessionActive(userId: string, linkSession: LinkSession) {
    const session = sessions.get(linkSession.tokenHash);
    return !!session && session.userId === userId && session.authGeneration === linkSession.generation &&
      !session.revokedAt && session.expiresAt.getTime() > Date.now();
  }

  function pruneExpiredMobileExchanges() {
    const now = Date.now();
    for (const [code, exchange] of mobileExchanges.entries()) {
      if (exchange.exchangeExpiresAt.getTime() <= now) {
        mobileExchanges.delete(code);
      }
    }
  }

  return {
    isMemoryLinkSessionActive,
    async createOAuthTransaction(input) {
      if (input.purpose === 'link' && (!input.userId || !isMemoryLinkSessionActive(input.userId, readLinkSession(input)))) {
        throw conflictOrStaleUpdateError('Account authentication changed. Start linking again.');
      }
      transactions.set(input.state, input);
    },

    async consumeOAuthTransaction(state) {
      const transaction = transactions.get(state) ?? null;
      transactions.delete(state);
      return transaction;
    },

    async createSession(userId, tokenHash, expiresAt, authorization) {
      if (authorization?.linkSession && !isMemoryLinkSessionActive(userId, authorization.linkSession)) {
        throw conflictOrStaleUpdateError('Account authentication changed. Start linking again.');
      }
      sessions.set(tokenHash, { userId, expiresAt, revokedAt: null, authGeneration: authorization?.generation ?? 0 });
    },

    async rotateSession(token, nextHash, expiresAt) {
      const session = sessions.get(hashToken(token));
      if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
      session.revokedAt = new Date();
      sessions.set(nextHash, { userId: session.userId, expiresAt, revokedAt: null, authGeneration: session.authGeneration });
      return session.userId;
    },
    async revokeUserSessions(userId) {
      for (const session of sessions.values()) if (session.userId === userId) session.revokedAt = new Date();
      for (const [state, transaction] of transactions) if (transaction.userId === userId && transaction.purpose === 'link') transactions.delete(state);
    },

    async getSessionByToken(token) {
      const tokenHash = hashToken(token);
      const session = sessions.get(tokenHash);
      if (!session || session.revokedAt) {
        return null;
      }

      return { userId: session.userId, expiresAt: session.expiresAt, authGeneration: session.authGeneration };
    },

    async revokeSessionByToken(token, options) {
      const session = sessions.get(hashToken(token));
      if (!session) return;
      session.revokedAt = new Date();
      if (options?.cancelPendingLinks) {
        for (const [state, pending] of transactions) {
          if (pending.purpose === 'link' && pending.userId === session.userId) transactions.delete(state);
        }
      }
    },

    async createMobileAuthExchange(input) {
      pruneExpiredMobileExchanges();
      mobileExchanges.set(input.code, input);
    },

    async consumeMobileAuthExchange(code, exchangeChallenge) {
      pruneExpiredMobileExchanges();
      const exchange = mobileExchanges.get(code) ?? null;
      if (!exchange || exchange.exchangeChallenge !== exchangeChallenge) {
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
  let generatedClientSecret: { value: Promise<string>; refreshAfterEpochMilliseconds: number } | null = null;

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
    if (generatedClientSecret && generatedClientSecret.refreshAfterEpochMilliseconds > Date.now()) {
      return generatedClientSecret.value;
    }

    const privateKey = await loadApplePrivateKey();

    if (!env.AUTH_APPLE_TEAM_ID || !env.AUTH_APPLE_KEY_ID || !privateKey) {
      throw new Error(
        'AUTH_APPLE_TEAM_ID, AUTH_APPLE_KEY_ID, and AUTH_APPLE_PRIVATE_KEY or AUTH_APPLE_PRIVATE_KEY_PATH are required for Apple OAuth.',
      );
    }

    const teamId = env.AUTH_APPLE_TEAM_ID;
    const keyId = env.AUTH_APPLE_KEY_ID;
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = issuedAtSeconds + appleClientSecretTtlSeconds;
    const clientSecret = (async () => {
      const key = await importPKCS8(privateKey, 'ES256');

      return new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: keyId })
        .setIssuer(teamId)
        .setSubject(appleClientId)
        .setAudience('https://appleid.apple.com')
        .setIssuedAt(issuedAtSeconds)
        .setExpirationTime(expiresAtSeconds)
        .sign(key);
    })();

    generatedClientSecret = {
      refreshAfterEpochMilliseconds: (expiresAtSeconds - appleClientSecretRefreshSkewSeconds) * 1000,
      value: clientSecret.catch((error: unknown) => {
        generatedClientSecret = null;
        throw error;
      }),
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
  providers: Partial<Record<AuthProviderName, OAuthProviderAdapter>>;
}): AuthService {
  const { authRepository, providers, userStateStore } = input;
  userStateStore.onSessionsRevoked?.((userId) => authRepository.revokeUserSessions(userId));
  const sessionTtlMilliseconds = env.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

  async function issueSession(userId: string, authorization: SessionAuthorization) {
    const sessionToken = buildSessionToken();
    const expiresAt = new Date(Date.now() + sessionTtlMilliseconds);
    await authRepository.createSession(userId, hashToken(sessionToken), expiresAt, authorization);
    if (await userStateStore.getAuthenticationGeneration(userId) !== authorization.generation) {
      await authRepository.revokeSessionByToken(sessionToken);
      throw conflictOrStaleUpdateError('Account authentication changed. Sign in again.');
    }

    return {
      sessionToken,
      expiresAt,
    };
  }

  return {
    async startAuthentication({ provider, purpose, redirectTo, userId, initiatingToken, callbackUrl, exchangeChallenge }) {
      const adapter = providers[provider];
      if (!adapter) throw conflictOrStaleUpdateError('This sign-in provider is not configured.');
      const codeVerifier = buildCodeVerifier();
      const state = randomUUID();
      const expiresAt = new Date(Date.now() + oauthTransactionTtlMilliseconds);

      const initiatingSession = purpose === 'link' && initiatingToken ? await authRepository.getSessionByToken(initiatingToken) : null;
      const authGeneration = initiatingSession?.authGeneration ?? null;
      if (purpose === 'link' && (!initiatingSession || initiatingSession.userId !== userId || initiatingSession.expiresAt.getTime() <= Date.now() || authGeneration !== await userStateStore.getAuthenticationGeneration(initiatingSession.userId))) throw missingUserStateError('Sign in before linking another provider.');
      await authRepository.createOAuthTransaction({
        authGeneration,
        initiatingSessionHash: initiatingSession && initiatingToken ? hashToken(initiatingToken) : null,
        state,
        provider,
        purpose,
        userId: userId ?? null,
        redirectTo: redirectTo ?? null,
        codeVerifier,
        exchangeChallenge: exchangeChallenge ?? null,
        expiresAt,
      });

      const next = adapter.buildAuthorizationUrl({
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

      if (provider && transaction.provider !== provider) {
        throw conflictOrStaleUpdateError('OAuth transaction provider mismatch.');
      }

      if (transaction.expiresAt.getTime() <= Date.now()) {
        throw conflictOrStaleUpdateError('OAuth transaction has expired.');
      }

      if (transaction.redirectTo && requiresExchangeHandoff(transaction.redirectTo) && !transaction.exchangeChallenge) {
        throw conflictOrStaleUpdateError('Restart sign-in to verify this client.');
      }
      const linkSession = transaction.purpose === 'link' ? readLinkSession(transaction) : undefined;
      if (linkSession && !transaction.userId) throw conflictOrStaleUpdateError('Start linking again.');

      const adapter = providers[transaction.provider];
      if (!adapter) throw conflictOrStaleUpdateError('This sign-in provider is not configured.');
      const identity = await adapter.exchangeCode({
        code,
        redirectUri: callbackUrl,
        codeVerifier: transaction.codeVerifier,
      });

      const resolved = await userStateStore.resolveOAuthIdentity({
        ...identity,
        linkedUserId: linkSession ? transaction.userId : null,
        linkedSession: linkSession,
        isMemoryLinkSessionActive: linkSession && transaction.userId && authRepository.isMemoryLinkSessionActive
          ? authRepository.isMemoryLinkSessionActive.bind(authRepository, transaction.userId, linkSession)
          : undefined,
      });

      if (identity.activate) await userStateStore.activateOAuthIdentity(resolved.user.id, identity, resolved.authGeneration, identity.activate);
      await userStateStore.updateStreakOnLogin(resolved.user.id, new Date());
      const session = await issueSession(resolved.user.id, {
        generation: resolved.authGeneration, provider: identity.provider, subject: identity.providerSubjectId, linkSession,
      });

      return {
        provider: transaction.provider,
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt.toISOString(),
        user: resolved.user,
        isNewUser: resolved.isNewUser,
        effectiveLevel: resolved.effectiveLevel,
        redirectTo: transaction.redirectTo,
        exchangeChallenge: transaction.exchangeChallenge ?? null,
      };
    },

    async issueMobileAuthExchangeCode({ exchangeChallenge, sessionToken, expiresAt, user, isNewUser, effectiveLevel }) {
      authExchangeChallengeSchema.parse(exchangeChallenge);
      const exchangeCode = randomUUID();
      const exchangeExpiresAt = new Date(Date.now() + mobileExchangeTtlMilliseconds);
      const sessionExpiresAt = new Date(expiresAt);

      await authRepository.createMobileAuthExchange({
        code: exchangeCode,
        exchangeChallenge,
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

    async redeemMobileAuthExchangeCode(code, verifier) {
      if (!authExchangeVerifierSchema.safeParse(verifier).success) return null;
      const exchange = await authRepository.consumeMobileAuthExchange(code, buildCodeChallenge(verifier));
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
      const sessionToken = buildSessionToken();
      const expiresAt = new Date(Date.now() + sessionTtlMilliseconds);
      const userId = await authRepository.rotateSession(token, hashToken(sessionToken), expiresAt);
      if (!userId) return null;
      const currentSession = await authRepository.getSessionByToken(sessionToken);
      if (!currentSession || currentSession.authGeneration !== await userStateStore.getAuthenticationGeneration(userId)) {
        await authRepository.revokeSessionByToken(sessionToken); return null;
      }
      const user = await userStateStore.getUserById(userId);
      if (!user) {
        await authRepository.revokeSessionByToken(sessionToken);
        throw missingUserStateError('Session belongs to a deleted user.');
      }
      const effectiveLevel = await userStateStore.getUserEffectiveLevel(user.id);
      const refreshedSession = { sessionToken, expiresAt };

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

      await authRepository.revokeSessionByToken(token, { cancelPendingLinks: true });

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

      if (session.authGeneration !== await userStateStore.getAuthenticationGeneration(session.userId)) return null;
      const user = await userStateStore.getUserById(session.userId);
      if (!user) {
        throw missingUserStateError('Session belongs to a deleted user.');
      }

      return user;
    },
    async close() { await authRepository.close?.(); },
  };
}
