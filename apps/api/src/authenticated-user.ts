import { userSchema } from '@3plates/contract';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { UserStateStore } from './user-state-store.js';

const requestUserHeadersSchema = z.object({
  'x-user-email': z.string().email(),
  'x-user-display-name': z.string().min(1).optional(),
});

export type AuthenticatedUser = z.infer<typeof userSchema>;

export type AuthenticatedUserResolver = (
  request: FastifyRequest,
  store: UserStateStore,
) => Promise<AuthenticatedUser | null>;

export async function defaultAuthenticatedUserResolver(
  request: FastifyRequest,
  store: UserStateStore,
): Promise<AuthenticatedUser | null> {
  const headers = requestUserHeadersSchema.safeParse({
    'x-user-email': request.headers['x-user-email'],
    'x-user-display-name': request.headers['x-user-display-name'],
  });

  if (!headers.success) {
    return null;
  }

  return store.getOrCreateUser({
    email: headers.data['x-user-email'],
    displayName: headers.data['x-user-display-name'] ?? null,
  });
}

export async function requireAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
  store: UserStateStore,
  resolver: AuthenticatedUserResolver,
): Promise<AuthenticatedUser | null> {
  const user = await resolver(request, store);

  if (!user) {
    reply.status(401);
    return reply.send({ error: 'Unauthorized' });
  }

  return user;
}