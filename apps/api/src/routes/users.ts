import type { FastifyInstance } from 'fastify';

import { requireAuthenticatedUser } from '../authenticated-user.js';

export async function registerUserRoutes(app: FastifyInstance) {
  app.get('/users/me', async (request, reply) => {
    const user = await requireAuthenticatedUser(request, reply);
    if (!user) {
      return reply;
    }

    return user;
  });
}
