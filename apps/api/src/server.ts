import cors from '@fastify/cors';
import Fastify from 'fastify';

import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerPreferencesRoutes } from './routes/preferences.js';
import { registerProgressRoutes } from './routes/progress.js';
import { registerUserRoutes } from './routes/users.js';

export function createServer() {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: true,
  });

  app.register(registerHealthRoutes);
  app.register(registerAuthRoutes);
  app.register(registerUserRoutes);
  app.register(registerProgressRoutes);
  app.register(registerPreferencesRoutes);
  app.register(registerNotificationRoutes);

  return app;
}
