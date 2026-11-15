import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authProviderSchema, calendarDateSchema, healthLogQuerySchema, healthMutationSchema } from '@3plates/contract';
import { z } from 'zod';
import type { HealthStore } from '../health-store.js';
import type { UserStateStore } from '../user-state-store.js';
import type { WhoopService, WhoopOperation } from '../whoop-service.js';
import { ApiError, conflictOrStaleUpdateError, invalidAuthError } from '../api-error.js';

function owner(request: FastifyRequest) {
  if (!request.authUser) throw invalidAuthError();
  return request.authUser.id;
}

export async function registerFitnessRoutes(app: FastifyInstance, store: UserStateStore,
  health: HealthStore, whoop?: WhoopService) {
  async function subject(userId: string) {
    const identity = (await store.listIdentities(userId)).find((value) => value.provider === 'whoop');
    if (!identity) throw conflictOrStaleUpdateError('Connect WHOOP in your account to view imported data.');
    return identity.providerSubjectId;
  }
  function integration() {
    if (!whoop) throw new ApiError(503, 'internal_error', 'WHOOP is not configured on this server.');
    return whoop;
  }
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.split('?')[0] === '/users/me' || request.url.startsWith('/users/me/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.get('/users/me/logs', async (request) => health.list(owner(request), healthLogQuerySchema.parse(request.query)));
  // Allow the contract's 100 exercises x 50 sets, including JSON-escaped text.
  app.post('/users/me/logs', { bodyLimit: 1024 * 1024, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
    const userId = owner(request);
    const mutation = healthMutationSchema.parse(request.body);
    return health.mutate(userId, mutation, async () => {
      if (mutation.entry?.kind === 'workout' && mutation.entry.details.linkedWhoopWorkoutId) {
        if (!await integration().ownsWorkout(await subject(userId), mutation.entry.details.linkedWhoopWorkoutId)) {
          throw conflictOrStaleUpdateError('That WHOOP workout is not available in your account.');
        }
      }
    });
  });
  app.get('/users/me/whoop/workouts', async (request) => {
    const { date } = z.object({ date: calendarDateSchema.optional() }).parse(request.query);
    return { workouts: await integration().workouts(await subject(owner(request)), date) };
  });
  app.get('/users/me/identities', async (request) => ({
    providers: [...new Set((await store.listIdentities(owner(request))).map((identity) => identity.provider))],
    whoopEnabled: !!whoop,
  }));
  app.delete('/users/me/identities/:provider', async (request) => {
    const userId = owner(request);
    const { provider } = z.object({ provider: authProviderSchema }).parse(request.params);
    await store.unlinkIdentity(userId, provider, provider === 'whoop' ? async (whoopId) => {
      const result = await integration().request(whoopId, 'delete', 'DELETE', {}, {});
      if (result.status !== 200 && result.status !== 401) throw new ApiError(503, 'internal_error', 'WHOOP removal failed. Please retry.');
    } : undefined);
    return { removed: true, signInAgain: true };
  });

  for (const [operation, methods] of Object.entries({
    profile: ['GET'], dashboard: ['GET'], sync: ['GET', 'POST'], sharing: ['POST'], export: ['GET'], disconnect: ['POST'],
  })) {
    for (const method of methods as Array<'GET' | 'POST'>) {
      app.route({ method, url: `/users/me/whoop/${operation}`,
        config: { rateLimit: { max: method === 'POST' ? 10 : 120, timeWindow: '1 minute' } },
        handler: async (request, reply) => {
          const userId = owner(request);
          const query = z.record(z.string(), z.string().max(200)).parse(request.query);
          const result = await integration().request(await subject(userId), operation as WhoopOperation, method, query, request.body);
          reply.code(result.status).type(result.contentType).header('Cache-Control', 'no-store');
          if (operation === 'export') reply.header('Content-Disposition', `attachment; filename="3plates-whoop.${query.format === 'csv' ? 'csv' : 'json'}"`);
          return reply.send(result.body);
        },
      });
    }
  }

  app.get('/users/me/export', async (request, reply) => {
    const userId = owner(request);
    const logs = [];
    let cursor: string | undefined;
    do {
      const page = await health.list(userId, { limit: 200, cursor });
      logs.push(...page.logs.filter((record) => record.entry));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    reply.header('Content-Disposition', 'attachment; filename="3plates-manual-data.json"');
    return { exportedAt: new Date().toISOString(), user: request.authUser, logs,
      legacyWorkouts: await store.listManualWorkouts(userId), preferences: await store.getPreferences(userId) };
  });

  let deleting = false;
  let cleanup: Promise<void> | undefined;
  async function processDeletions() {
    if (deleting) return;
    deleting = true;
    try {
      let cursor: string | undefined;
      while (true) {
        const batch = await store.pendingDeletions(cursor);
        if (!batch.length) break;
        cursor = batch[batch.length - 1];
        for (const userId of batch) {
          try {
            const identity = (await store.listIdentities(userId)).find((value) => value.provider === 'whoop');
            if (identity) {
              const result = await integration().request(identity.providerSubjectId, 'delete', 'DELETE', {}, {});
              if (result.status !== 200 && result.status !== 401) continue;
            }
            await store.deleteAccount(userId);
          } catch { app.log.warn({ event: 'account_cleanup_retry' }, 'Account cleanup will retry.'); }
        }
      }
    } finally { deleting = false; }
  }
  app.delete('/users/me', async (request, reply) => {
    z.object({ confirmation: z.literal('DELETE') }).parse(request.body);
    await store.requestDeletion(owner(request));
    // Persistent deletion marker disables authentication immediately; the
    // cleanup loop resumes after crashes or temporary provider outages.
    reply.code(202);
    return { deletionRequested: true };
  });
  const runCleanup = () => cleanup ??= processDeletions().finally(() => { cleanup = undefined; });
  const timer = setInterval(() => { void runCleanup().catch(() => app.log.warn({ event: 'account_cleanup_unavailable' })); }, 60000);
  timer.unref();
  app.addHook('onReady', async () => { void runCleanup().catch(() => app.log.warn({ event: 'account_cleanup_unavailable' })); });
  app.addHook('onClose', async () => { clearInterval(timer); await cleanup; await health.close(); if (whoop) await whoop.close(); });
}
