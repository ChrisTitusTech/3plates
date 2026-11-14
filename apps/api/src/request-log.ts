import type { FastifyRequest, FastifyReply } from 'fastify';

// OAuth callback query strings contain credentials. Never include them in logs.
export function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: request.url.split('?')[0],
    hostname: request.hostname,
    remoteAddress: request.ip,
  };
}

// Fastify default 404 logging includes the raw URL outside the request serializer.
export function handleNotFound(_request: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send({
    ok: false,
    error: { code: 'route_not_found', message: 'Route not found.' },
  });
}
