import { progressSchema } from '@3plates/contract';
import type { FastifyInstance } from 'fastify';

import { requireAuthenticatedUser } from '../authenticated-user.js';
import type { AuthenticatedUserResolver } from '../authenticated-user.js';
import type { UserStateStore } from '../user-state-store.js';

export async function registerProgressRoutes(
  app: FastifyInstance,
  store: UserStateStore,
  resolveAuthenticatedUser: AuthenticatedUserResolver,
) {
  app.get('/users/me/progress', async (request, reply) => {
    const user = await requireAuthenticatedUser(request, reply, store, resolveAuthenticatedUser);
    if (!user) {
      return reply;
    }

    return store.getProgress(user.id);
  });

  app.put('/users/me/progress', async (request, reply) => {
    const user = await requireAuthenticatedUser(request, reply, store, resolveAuthenticatedUser);
    if (!user) {
      return reply;
    }

    const progress = progressSchema.parse(request.body);
    await store.updateProgress(user.id, progress);

    return {
      updated: true,
    };
  });
}
