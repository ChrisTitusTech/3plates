import {
  adminWorkoutCreateSchema,
  adminWorkoutPublishSchema,
  adminWorkoutUpdateSchema,
} from '@3plates/contract';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { adminAuthRequiredError, serializeApiError } from '../api-error.js';
import { env } from '../env.js';
import type { UserStateStore } from '../user-state-store.js';

const workoutParamsSchema = z.object({
  workoutId: z.string().uuid(),
});

function resolveAdminIdentity(request: { headers: Record<string, string | string[] | undefined> }) {
  const configuredApiKey = env.ADMIN_API_KEY;
  if (!configuredApiKey) {
    return null;
  }

  const headerValue = request.headers['x-admin-key'];
  const providedApiKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!providedApiKey || providedApiKey !== configuredApiKey) {
    return null;
  }

  return 'api-key';
}

function requireAdmin(
  request: { headers: Record<string, string | string[] | undefined> },
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  const adminIdentity = resolveAdminIdentity(request);
  if (!adminIdentity) {
    reply.status(401).send(serializeApiError(adminAuthRequiredError()));
    return null;
  }

  return adminIdentity;
}

export async function registerAdminWorkoutRoutes(app: FastifyInstance, store: UserStateStore) {
  app.post('/admin/workouts', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const adminIdentity = requireAdmin(request, reply);
    if (!adminIdentity) {
      return reply;
    }

    const payload = adminWorkoutCreateSchema.parse(request.body);
    return store.createWorkoutAdmin(adminIdentity, payload);
  });

  app.patch('/admin/workouts/:workoutId', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const adminIdentity = requireAdmin(request, reply);
    if (!adminIdentity) {
      return reply;
    }

    const { workoutId } = workoutParamsSchema.parse(request.params);
    const payload = adminWorkoutUpdateSchema.parse(request.body);
    return store.updateWorkoutAdmin(workoutId, payload);
  });

  app.post('/admin/workouts/:workoutId/publish', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const adminIdentity = requireAdmin(request, reply);
    if (!adminIdentity) {
      return reply;
    }

    const { workoutId } = workoutParamsSchema.parse(request.params);
    const payload = adminWorkoutPublishSchema.parse(request.body);
    return store.setWorkoutPublishedAdmin(workoutId, true, payload);
  });

  app.post('/admin/workouts/:workoutId/unpublish', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const adminIdentity = requireAdmin(request, reply);
    if (!adminIdentity) {
      return reply;
    }

    const { workoutId } = workoutParamsSchema.parse(request.params);
    const payload = adminWorkoutPublishSchema.parse(request.body);
    return store.setWorkoutPublishedAdmin(workoutId, false, payload);
  });
}
