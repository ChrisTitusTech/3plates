import { notificationDeviceSchema } from '@3plates/contract';
import type { FastifyInstance } from 'fastify';

import { requireAuthenticatedUser } from '../authenticated-user.js';
import type { AuthenticatedUserResolver } from '../authenticated-user.js';
import type { UserStateStore } from '../user-state-store.js';

export async function registerNotificationRoutes(
  app: FastifyInstance,
  store: UserStateStore,
  resolveAuthenticatedUser: AuthenticatedUserResolver,
) {
  app.post('/notifications/devices', async (request, reply) => {
    const user = await requireAuthenticatedUser(request, reply, store, resolveAuthenticatedUser);
    if (!user) {
      return reply;
    }

    const device = notificationDeviceSchema.parse(request.body);
    await store.registerDevice(user.id, device);

    return {
      registered: true,
    };
  });
}
