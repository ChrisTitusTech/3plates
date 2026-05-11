import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AuthenticatedUser } from './user-state-store.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthenticatedUser | null;
    authToken: string | null;
  }
}

export async function requireAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthenticatedUser | null> {
  const user = request.authUser;

  if (!user) {
    reply.status(401);
    return reply.send({ error: 'Unauthorized' });
  }

  return user;
}