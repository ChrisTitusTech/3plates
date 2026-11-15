import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { config } from "./config.js";
export const client = postgres(config.DATABASE_URL, {
  max: 5,
  idle_timeout: 20,
  onnotice: config.NODE_ENV === "test" ? () => {} : undefined,
});
export const db = drizzle(client);
