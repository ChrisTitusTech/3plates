import type { FastifyInstance } from 'fastify';

export async function registerProgressRoutes(app: FastifyInstance) {
  app.get('/users/me/progress', async () => {
    return {
      streakDays: 3,
      completedWorkouts: 12,
      lastWorkoutAt: new Date().toISOString(),
    };
  });

  app.put('/users/me/progress', async () => {
    return {
      updated: true,
    };
  });
}
