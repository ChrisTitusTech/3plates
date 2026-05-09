import type { FastifyInstance } from 'fastify';

export async function registerNotificationRoutes(app: FastifyInstance) {
  app.post('/notifications/devices', async () => {
    return {
      registered: true,
    };
  });
}
