import { workoutListQuerySchema } from '@3plates/contract';
import type { FastifyInstance } from 'fastify';

import { requireAuthenticatedUser } from '../authenticated-user.js';
import type { UserStateStore } from '../user-state-store.js';

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

    const query = workoutListQuerySchema.parse(request.query);
    const workouts = await store.listWorkouts(query.mode);
    const total = workouts.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
    const start = (query.page - 1) * query.pageSize;
    const end = start + query.pageSize;
    const pagedWorkouts = workouts.slice(start, end);

    return {
      workouts: pagedWorkouts,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
      ordering: {
        applied: query.order,
      },
    };
  });
}
