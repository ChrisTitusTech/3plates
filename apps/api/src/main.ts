import { env } from './env.js';
import { createServer } from './server.js';

const app = createServer();

await app.listen({
  port: env.API_PORT,
  host: env.API_HOST,
});
