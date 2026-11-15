import { env } from './env.js';
import { createServer } from './server.js';

const app = createServer();

await app.listen({
  port: env.API_PORT,
  host: env.API_HOST,
});

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  void app.close().catch(() => { process.exitCode = 1; });
});
