import "dotenv/config";
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./server/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
