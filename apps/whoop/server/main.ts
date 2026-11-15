import { buildApp } from "./app.js";
import { client } from "./db.js";
import { config } from "./config.js";
const app = await buildApp({ logger: true });
await app.listen({ host: "127.0.0.1", port: config.PORT });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.close();
    await client.end();
  });
