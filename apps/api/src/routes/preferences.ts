import type { FastifyInstance } from 'fastify';

export async function registerPreferencesRoutes(app: FastifyInstance) {
  app.get('/users/me/preferences', async () => {
    return {
      units: 'metric',
      reminderTime: '07:00',
      theme: 'system',
    };
  });

  app.put('/users/me/preferences', async () => {
    return {
      updated: true,
    };
  });
}
