import { preferencesSchema } from '@3plates/contract';
import type { FastifyInstance } from 'fastify';

import { requireAuthenticatedUser } from '../authenticated-user.js';
import type { UserStateStore } from '../user-state-store.js';

export async function registerPreferencesRoutes(app: FastifyInstance, store: UserStateStore) {
  app.get('/users/me/preferences', async (request, reply) => {
    const user = await requireAuthenticatedUser(request, reply);
    if (!user) {
      return reply;
    }

    return store.getPreferences(user.id);
  });

  app.put('/users/me/preferences', async (request, reply) => {
    const user = await requireAuthenticatedUser(request, reply);
    if (!user) {
      return reply;
    }

    const preferences = preferencesSchema.parse(request.body);
    await store.updatePreferences(user.id, preferences);

    return {
      updated: true,
    };
  });
}
