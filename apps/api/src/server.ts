import cors from '@fastify/cors';
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

function createDefaultAuthService(store: UserStateStore) {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to start the API without an injected auth service.');
  }

  return createAuthService({
    authRepository: createDbAuthRepository(env.DATABASE_URL),
    userStateStore: store,
    providers: {
      google: createGoogleOAuthProvider(),
      apple: createAppleOAuthProvider(),
    },
  });
}

export function createServer(options: CreateServerOptions = {}) {
  const app = Fastify({ logger: true });
  const store = options.store ?? createDefaultStore();
  const authService = options.authService ?? createDefaultAuthService(store);

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

    reply.status(500).send(serializeApiError(internalServerError()));
  });

  app.register(cors, {
    origin: true,
  });

  app.register(rateLimit, {
    global: false,
    max: 120,
    timeWindow: '1 minute',
  });

  app.register(registerHealthRoutes);
  app.register(async (authApp) => {
    await registerAuthRoutes(authApp, authService);
  });
  app.register(async (statefulApp) => {
    await registerAdminWorkoutRoutes(statefulApp, store);
    await registerUserRoutes(statefulApp);
    await registerProgressRoutes(statefulApp, store);
    await registerPreferencesRoutes(statefulApp, store);
    await registerNotificationRoutes(statefulApp, store);
    await registerWorkoutRoutes(statefulApp, store);
  });

  return app;
}
