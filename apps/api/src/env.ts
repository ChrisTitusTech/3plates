import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

export const ADMIN_API_KEY_PLACEHOLDER = 'replace-me-admin-key';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
const rootEnvExamplePath = fileURLToPath(new URL('../../../.env.example', import.meta.url));

config({
  path: existsSync(rootEnvPath) ? rootEnvPath : rootEnvExamplePath,
});

const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: optionalNonEmptyString,
  AUTH_SECRET: optionalNonEmptyString,
  AUTH_BASE_URL: optionalUrl,
  AUTH_GOOGLE_CLIENT_ID: optionalNonEmptyString,
  AUTH_GOOGLE_CLIENT_SECRET: optionalNonEmptyString,
  AUTH_APPLE_CLIENT_ID: optionalNonEmptyString,
  AUTH_APPLE_TEAM_ID: optionalNonEmptyString,
  AUTH_APPLE_KEY_ID: optionalNonEmptyString,
  AUTH_APPLE_PRIVATE_KEY: optionalNonEmptyString,
  AUTH_APPLE_PRIVATE_KEY_PATH: optionalNonEmptyString,
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ADMIN_API_KEY: z.string().min(1).default(ADMIN_API_KEY_PLACEHOLDER),
});

export const env = envSchema.parse(process.env);

export function getConfiguredAdminApiKey(): string | null {
  const key = env.ADMIN_API_KEY.trim();
  if (key.length === 0 || key === ADMIN_API_KEY_PLACEHOLDER) {
    return null;
  }

  return key;
}
