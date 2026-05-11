import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiError } from './api-error.js';
import type { UserRecord } from './user-state-store.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser: UserRecord | null;
    authToken: string | null;
    authError: ApiError | null;
  }
}

export async function requireAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<UserRecord | null> {
  const user = request.authUser;

  if (!user) {
    const authError = request.authError;
    const statusCode = authError?.statusCode ?? 401;
    const errorBody = authError
      ? {
          ok: false as const,
          error: {
            code: authError.code,
            message: authError.message,
          },
        }
      : {
          ok: false as const,
          error: {
            code: 'invalid_auth' as const,
            message: 'Authentication required.',
          },
        };

    reply.status(statusCode);
    return reply.send(errorBody);
  }

  return user;
}