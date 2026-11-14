import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { serializeRequest, handleNotFound } from './request-log.js';

test('request logs omit OAuth credentials and sensitive headers', async () => {
  let logs = '';
  const app = Fastify({
    logger: {
      serializers: { req: serializeRequest },
      stream: { write: (chunk: string) => { logs += chunk; } },
    },
  });
  app.setNotFoundHandler(handleNotFound);
  app.get('/auth/callback', async () => ({ ok: true }));
  try {
    await app.inject({
      url: '/auth/callback?code=private-code&state=private-state',
      headers: { authorization: 'Bearer private-token', cookie: 'private-cookie' },
    });
    const missing = await app.inject({ url: '/auth/callback/?code=private-code&state=private-state' });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, 'route_not_found');
    assert.equal(missing.body.includes('private-code'), false);
    assert.ok(logs.includes('/auth/callback'));
    for (const secret of ['private-code', 'private-state', 'private-token', 'private-cookie']) {
      assert.equal(logs.includes(secret), false);
    }
  } finally {
    await app.close();
  }
});
