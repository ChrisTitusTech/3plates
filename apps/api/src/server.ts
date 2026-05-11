import cors from '@fastify/cors';
import Fastify from 'fastify';

import {
  defaultAuthenticatedUserResolver,
} from './authenticated-user.js';
import type { AuthenticatedUserResolver } from './authenticated-user.js';
import { env } from './env.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerPreferencesRoutes } from './routes/preferences.js';
import { registerProgressRoutes } from './routes/progress.js';
import { registerUserRoutes } from './routes/users.js';
import { createDbUserStateStore } from './user-state-store.js';
import type { UserStateStore } from './user-state-store.js';

type CreateServerOptions = {
  store?: UserStateStore;
  authenticatedUserResolver?: AuthenticatedUserResolver;
};

function createDefaultStore() {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to start the API without an injected state store.');
  }

  return createDbUserStateStore(env.DATABASE_URL);
}

export function createServer(options: CreateServerOptions = {}) {
  const app = Fastify({ logger: true });
  const store = options.store ?? createDefaultStore();
  const authenticatedUserResolver =
    options.authenticatedUserResolver ?? defaultAuthenticatedUserResolver;

  app.register(cors, {
    origin: true,
  });

  app.register(registerHealthRoutes);
  app.register(registerAuthRoutes);
  app.register(async (statefulApp) => {
    await registerUserRoutes(statefulApp, store, authenticatedUserResolver);
    await registerProgressRoutes(statefulApp, store, authenticatedUserResolver);
    await registerPreferencesRoutes(statefulApp, store, authenticatedUserResolver);
    await registerNotificationRoutes(statefulApp, store, authenticatedUserResolver);
  });

  return app;
}
