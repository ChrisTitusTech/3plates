import { manualWorkoutCreateSchema } from '@3plates/contract';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuthenticatedUser } from '../authenticated-user.js';
import type { UserStateStore } from '../user-state-store.js';

const manualWorkoutParamsSchema = z.object({
  workoutId: z.string().uuid(),
});

export async function registerManualWorkoutRoutes(app: FastifyInstance, store: UserStateStore) {
  app.get('/users/me/manual-workouts', {
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

    return {
      workouts: await store.listManualWorkouts(user.id),
    };
  });

  app.post('/users/me/manual-workouts', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const user = await requireAuthenticatedUser(request, reply);
    if (!user) {
      return reply;
    }

    const workout = manualWorkoutCreateSchema.parse(request.body);
    return store.createManualWorkout(user.id, workout);
  });

  app.delete('/users/me/manual-workouts/:workoutId', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const user = await requireAuthenticatedUser(request, reply);
    if (!user) {
      return reply;
    }

    const params = manualWorkoutParamsSchema.parse(request.params);
    await store.deleteManualWorkout(user.id, params.workoutId);

    return {
      deleted: true,
    };
  });
}
