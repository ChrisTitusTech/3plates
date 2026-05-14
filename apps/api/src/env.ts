import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
const rootEnvExamplePath = fileURLToPath(new URL('../../../.env.example', import.meta.url));

config({
  path: existsSync(rootEnvPath) ? rootEnvPath : rootEnvExamplePath,
});

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(1).optional(),
  AUTH_BASE_URL: z.string().url().optional(),
  AUTH_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  AUTH_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  AUTH_APPLE_CLIENT_ID: z.string().min(1).optional(),
  AUTH_APPLE_CLIENT_SECRET: z.string().min(1).optional(),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ADMIN_API_KEY: z.string().min(1).default('replace-me-admin-key'),
});

export const env = envSchema.parse(process.env);
