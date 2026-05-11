import type { FastifyInstance } from 'fastify';

import { requireAuthenticatedUser } from '../authenticated-user.js';
import type { AuthenticatedUserResolver } from '../authenticated-user.js';
import type { UserStateStore } from '../user-state-store.js';

export async function registerUserRoutes(
  app: FastifyInstance,
  store: UserStateStore,
  resolveAuthenticatedUser: AuthenticatedUserResolver,
) {
  app.get('/users/me', async (request, reply) => {
    const user = await requireAuthenticatedUser(request, reply, store, resolveAuthenticatedUser);
    if (!user) {
      return reply;
    }

    return user;
  });
}
