import { authProviderSchema, authExchangeChallengeSchema, authExchangeVerifierSchema } from '@3plates/contract';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireAuthenticatedUser } from '../authenticated-user.js';
import type { AuthService } from '../auth-service.js';
import {
  conflictOrStaleUpdateError,
  invalidAuthError,
  invalidRequestPayloadError,
} from '../api-error.js';
import { env } from '../env.js';
import { isAllowedAuthRedirect, requiresExchangeHandoff } from '../auth-redirect.js';

const authStartBodySchema = z.object({
  provider: authProviderSchema,
  redirectTo: z.string().url().optional(),
  exchangeChallenge: authExchangeChallengeSchema.optional(),
});

const authExchangeBodySchema = z.object({
  code: z.string().min(1),
  verifier: authExchangeVerifierSchema,
});

function getCallbackUrl(request: FastifyRequest) {
  const baseUrl = env.AUTH_BASE_URL ?? `${request.protocol}://${request.headers.host}`;
  return new URL('/auth/callback', baseUrl).toString();
}

function getAuthorizationToken(request: FastifyRequest) {
  const authorizationHeader = request.headers.authorization;
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return null;
  }

  return authorizationHeader.slice('Bearer '.length).trim() || null;
}

async function handleStartAuthentication(
  request: FastifyRequest,
  reply: FastifyReply,
  authService: AuthService,
  purpose: 'sign-in' | 'link',
) {
  const parsedBody = authStartBodySchema.safeParse(request.body);

  if (!parsedBody.success) {
    throw invalidRequestPayloadError();
  }

  if (parsedBody.data.redirectTo && !isAllowedAuthRedirect(parsedBody.data.redirectTo)) {
    throw invalidRequestPayloadError('Redirect URL is not allowed.');
  }

  const needsExchange = !!parsedBody.data.redirectTo && requiresExchangeHandoff(parsedBody.data.redirectTo);
  if (needsExchange !== !!parsedBody.data.exchangeChallenge) {
    throw invalidRequestPayloadError('App callbacks require a client exchange challenge.');
  }

  const currentUser = purpose === 'link' ? request.authUser : null;
  if (purpose === 'link' && !currentUser) {
    throw invalidAuthError();
  }

  const startedAuth = await authService.startAuthentication({
    provider: parsedBody.data.provider,
    exchangeChallenge: parsedBody.data.exchangeChallenge,
    purpose,
    redirectTo: parsedBody.data.redirectTo ?? null,
    userId: currentUser?.id ?? null,
    initiatingToken: request.authToken,
    callbackUrl: getCallbackUrl(request),
  });

  return {
    ok: true,
    provider: parsedBody.data.provider,
    next: startedAuth.next,
    state: startedAuth.state,
  };
}

export async function registerAuthRoutes(app: FastifyInstance, authService: AuthService) {
  app.post('/auth/start', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => handleStartAuthentication(request, reply, authService, 'sign-in'));

  app.post('/auth/link', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => handleStartAuthentication(request, reply, authService, 'link'));

  app.get('/auth/callback', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const query = request.query as { provider?: unknown; code?: unknown; state?: unknown };
    let provider = null as z.infer<typeof authProviderSchema> | null;
    if (query.provider !== undefined) {
      const providerResult = authProviderSchema.safeParse(query.provider);
      if (!providerResult.success) {
        throw invalidRequestPayloadError();
      }
      provider = providerResult.data;
    }

    const code = typeof query.code === 'string' ? query.code : null;
    const state = typeof query.state === 'string' ? query.state : null;

    if (!code || !state) {
      throw invalidRequestPayloadError();
    }

    const completedAuth = await authService.completeAuthentication({
      provider,
      code,
      state,
      callbackUrl: getCallbackUrl(request),
    });

    if (completedAuth.redirectTo && requiresExchangeHandoff(completedAuth.redirectTo)) {
      if (!completedAuth.exchangeChallenge) throw conflictOrStaleUpdateError('Restart sign-in to verify this client.');
      const redirectUrl = new URL(completedAuth.redirectTo);
      const exchange = await authService.issueMobileAuthExchangeCode({
        exchangeChallenge: completedAuth.exchangeChallenge,
        sessionToken: completedAuth.sessionToken,
        expiresAt: completedAuth.expiresAt,
        user: completedAuth.user,
        isNewUser: completedAuth.isNewUser,
        effectiveLevel: completedAuth.effectiveLevel,
      });

      redirectUrl.searchParams.set('provider', completedAuth.provider);
      redirectUrl.searchParams.set('exchangeCode', exchange.code);
      redirectUrl.searchParams.set('state', state);
      redirectUrl.searchParams.set('expiresAt', completedAuth.expiresAt);

      return reply
        .code(302)
        .header('location', redirectUrl.toString())
        .send();
    }

    return {
      ok: true,
      provider: completedAuth.provider,
      redirectTo: completedAuth.redirectTo,
      sessionToken: completedAuth.sessionToken,
      expiresAt: completedAuth.expiresAt,
      user: completedAuth.user,
      isNewUser: completedAuth.isNewUser,
      effectiveLevel: completedAuth.effectiveLevel,
    };
  });

  app.post('/auth/refresh', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
      },
    },
  }, async (request) => {
    const token = request.authToken ?? getAuthorizationToken(request);
    if (!token) {
      throw invalidAuthError();
    }

    const refreshedSession = await authService.refreshSession(token);
    if (!refreshedSession) {
      throw invalidAuthError();
    }

    return {
      ok: true,
      sessionToken: refreshedSession.sessionToken,
      expiresAt: refreshedSession.expiresAt,
      user: refreshedSession.user,
      isNewUser: refreshedSession.isNewUser,
      effectiveLevel: refreshedSession.effectiveLevel,
    };
  });

  app.post('/auth/sign-out', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
      },
    },
  }, async (request) => {
    const token = request.authToken ?? getAuthorizationToken(request);
    if (!token) {
      throw invalidAuthError();
    }

    const signedOut = await authService.signOut(token);
    if (!signedOut) {
      throw invalidAuthError();
    }

    return {
      signedOut: true,
    };
  });

  app.post('/auth/exchange', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
  }, async (request) => {
    const parsedBody = authExchangeBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      throw invalidRequestPayloadError();
    }

    const exchangeRecord = await authService.redeemMobileAuthExchangeCode(parsedBody.data.code, parsedBody.data.verifier);
    if (!exchangeRecord) {
      throw conflictOrStaleUpdateError('Exchange code is missing or expired.');
    }

    return {
      ok: true,
      sessionToken: exchangeRecord.sessionToken,
      expiresAt: exchangeRecord.expiresAt,
      user: exchangeRecord.user,
      isNewUser: exchangeRecord.isNewUser,
      effectiveLevel: exchangeRecord.effectiveLevel,
    };
  });
}
