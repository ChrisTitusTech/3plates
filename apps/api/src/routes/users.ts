import type { FastifyInstance } from 'fastify';

export async function registerUserRoutes(app: FastifyInstance) {
  app.get('/users/me', async () => {
    return {
      id: 'user_123',
      email: 'user@example.com',
      displayName: 'Demo User',
    };
  });
}
