import { createDbHealthStore, createMemoryHealthStore, type HealthStore } from './health-store.js';
import { createWhoopService, type WhoopService } from './whoop-service.js';
import { registerFitnessRoutes } from './routes/fitness.js';
import cors from '@fastify/cors';
import { serializeRequest, handleNotFound } from './request-log.js';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';

import {
  createAppleOAuthProvider,
  createAuthService,
  createDbAuthRepository,
  createGoogleOAuthProvider,
} from './auth-service.js';
import type { AuthService } from './auth-service.js';
import { env } from './env.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminWorkoutRoutes } from './routes/admin-workouts.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerManualWorkoutRoutes } from './routes/manual-workouts.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerPreferencesRoutes } from './routes/preferences.js';
import { registerProgressRoutes } from './routes/progress.js';
import { registerUserRoutes } from './routes/users.js';
import { registerWorkoutRoutes } from './routes/workouts.js';
import { createDbUserStateStore } from './user-state-store.js';
import type { UserStateStore } from './user-state-store.js';
import {
  internalServerError,
  invalidAuthError,
  invalidRequestPayloadError,
  isApiError,
  serializeApiError,
} from './api-error.js';

type CreateServerOptions = {
  store?: UserStateStore;
  healthStore?: HealthStore;
  whoop?: WhoopService;
  authService?: AuthService;
};

function parseBearerToken(authorizationHeader: string | undefined) {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function createDefaultStore() {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to start the API without an injected state store.');
  }

  return createDbUserStateStore(env.DATABASE_URL);
}

function createDefaultAuthService(store: UserStateStore, whoop?: WhoopService) {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to start the API without an injected auth service.');
  }

  return createAuthService({
    authRepository: createDbAuthRepository(env.DATABASE_URL),
    userStateStore: store,
    providers: {
      google: createGoogleOAuthProvider(),
      apple: createAppleOAuthProvider(),
      ...(whoop ? { whoop: whoop.provider } : {}),
    },
  });
}

export function createServer(options: CreateServerOptions = {}) {
  const app = Fastify({ bodyLimit: 64 * 1024, logger: { serializers: { req: serializeRequest } } });
  app.setNotFoundHandler(handleNotFound);
  const store = options.store ?? createDefaultStore();
  const whoop = options.whoop ?? createWhoopService();
  const health = options.healthStore ?? (options.store ? createMemoryHealthStore() : createDbHealthStore(env.DATABASE_URL!));
  const authService = options.authService ?? createDefaultAuthService(store, whoop);
  app.addHook('onClose', async () => {
    if (!options.authService) await authService.close?.();
    if (!options.store) await store.close?.();
  });

  app.decorateRequest('authUser', null);
  app.decorateRequest('authToken', null);
  app.decorateRequest('authError', null);

  app.addHook('onRequest', async (request) => {
    const token = parseBearerToken(request.headers.authorization);
    request.authToken = token;
    request.authError = null;

    if (!token) {
      request.authUser = null;
      return;
    }

    try {
      request.authUser = await authService.resolveRequestUser(token);
      if (!request.authUser) {
        request.authError = invalidAuthError();
      }
    } catch (error) {
      request.authUser = null;
      if (isApiError(error)) {
        request.authError = error;
        return;
      }

      throw error;
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send(
        serializeApiError(invalidRequestPayloadError('Request payload is invalid.')),
      );
      return;
    }

    if (isApiError(error)) {
      reply.status(error.statusCode).send(serializeApiError(error));
      return;
    }

    // Preserve framework client errors, including rate limiting and JSON parsing.
    if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      reply.status(error.statusCode).send({
        ok: false,
        error: {
          code: error.statusCode === 429 ? 'rate_limit_exceeded' : 'invalid_request_payload',
          message: error.statusCode === 429 ? 'Too many requests. Try again later.' : 'Request payload is invalid.',
        },
      });
      return;
    }

    reply.status(500).send(serializeApiError(internalServerError()));
  });

  app.register(cors, {
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.register(rateLimit, {
    global: false,
    max: 120,
    timeWindow: '1 minute',
  });

  app.get('/auth/providers', async () => ({ providers: [
    ...(env.AUTH_GOOGLE_CLIENT_ID ? ['google'] : []),
    ...(env.AUTH_APPLE_CLIENT_ID ? ['apple'] : []),
    ...(whoop ? ['whoop'] : []),
  ] }));
  app.register(registerHealthRoutes);
  app.register(async (authApp) => {
    await registerAuthRoutes(authApp, authService);
  });
  app.register(async (statefulApp) => {
    await registerFitnessRoutes(statefulApp, store, health, whoop);
    await registerAdminWorkoutRoutes(statefulApp, store);
    await registerUserRoutes(statefulApp);
    await registerProgressRoutes(statefulApp, store);
    await registerManualWorkoutRoutes(statefulApp, store);
    await registerPreferencesRoutes(statefulApp, store);
    await registerNotificationRoutes(statefulApp, store);
    await registerWorkoutRoutes(statefulApp, store);
  });

  return app;
}
