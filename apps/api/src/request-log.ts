import type { FastifyRequest } from 'fastify';

// OAuth callback query strings contain credentials. Never include them in logs.
export function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: request.url.split('?')[0],
    hostname: request.hostname,
    remoteAddress: request.ip,
  };
}
