import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, client } from "./db.js";
await migrate(db, { migrationsFolder: "./drizzle" });
await client.end();
console.log("Database migrations complete.");
