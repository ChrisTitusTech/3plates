import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { fetchFitnessText } from './fitness-http';

test('the fitness request deadline includes a stalled response body', async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.flushHeaders();
    response.write('{');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await assert.rejects(fetchFitnessText(`http://127.0.0.1:${address.port}`, 'test', 'GET', undefined, 100),
    (error: unknown) => error instanceof Error && error.name === 'AbortError');
});
