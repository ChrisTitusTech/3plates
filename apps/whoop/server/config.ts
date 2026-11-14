import "dotenv/config";
import { z } from "zod";
export const config = z
  .object({
    ClientID: z.string().min(1),
    ClientSecret: z.string().min(1),
    DATABASE_URL: z.string().url(),
    PUBLIC_URL: z.string().url().default("https://whoop.3spinningplates.com"),
    TOKEN_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
    PORT: z.coerce.number().default(3100),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  })
  .parse(process.env);
export const origin = new URL(config.PUBLIC_URL).origin;
export const scopes =
  "offline read:profile read:cycles read:sleep read:recovery read:workout read:body_measurement";
