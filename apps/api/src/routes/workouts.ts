import { workoutModeSchema } from '@3plates/contract';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuthenticatedUser } from '../authenticated-user.js';
import type { UserStateStore } from '../user-state-store.js';

const workoutQuerySchema = z.object({
  mode: workoutModeSchema,
});

export async function registerWorkoutRoutes(app: FastifyInstance, store: UserStateStore) {
  app.get('/workouts', {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const user = await requireAuthenticatedUser(request, reply);
    if (!user) {
      return reply;
    }

    const query = workoutQuerySchema.parse(request.query);
    const workouts = await store.listWorkouts(query.mode);

    return {
      workouts,
    };
  });
}
