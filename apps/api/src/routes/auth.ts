import type { FastifyInstance } from 'fastify';

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/auth/start', async () => {
    return {
      ok: true,
      provider: 'google',
      next: '/auth/callback',
    };
  });

  app.post('/auth/link', async () => {
    return {
      ok: true,
      linked: true,
    };
  });
}
