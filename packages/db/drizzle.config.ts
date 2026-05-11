import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'drizzle-kit';

const rootEnvPath = fileURLToPath(new URL('../../.env', import.meta.url));
const rootEnvExamplePath = fileURLToPath(new URL('../../.env.example', import.meta.url));

config({
  path: existsSync(rootEnvPath) ? rootEnvPath : rootEnvExamplePath,
});

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
