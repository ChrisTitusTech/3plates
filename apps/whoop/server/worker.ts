import { eq, lt } from "drizzle-orm";
import { setTimeout } from "node:timers/promises";
import { client, db } from "./db.js";
import { heartbeat, jobs, oauthStates, sessions, webhooks } from "./schema.js";
import { claimJob, processJob, retryJob, schedule } from "./sync.js";
const connection = await client.reserve();
const [lock] =
  await connection`select pg_try_advisory_lock(834702) as acquired`;
if (!lock.acquired) throw new Error("Another WHOOP worker is already running");
await db
  .update(jobs)
  .set({ status: "pending" })
  .where(eq(jobs.status, "running"));
let stopping = false;
let lastSchedule = 0;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
console.log("WHOOP worker started");
try {
  while (!stopping) {
    if (Date.now() - lastSchedule > 60000) {
      await schedule();
      await db.delete(sessions).where(lt(sessions.expires, new Date()));
      await db.delete(oauthStates).where(lt(oauthStates.expires, new Date()));
      await db
        .delete(webhooks)
        .where(lt(webhooks.received, new Date(Date.now() - 14 * 86400000)));
      lastSchedule = Date.now();
    }
    await db
      .insert(heartbeat)
      .values({ name: "worker", at: new Date() })
      .onConflictDoUpdate({ target: heartbeat.name, set: { at: new Date() } });
    const job = await claimJob();
    if (job) {
      try {
        await processJob(job);
      } catch (error) {
        await retryJob(job, error);
        console.warn(
          JSON.stringify({
            event: "job_retry",
            job: job.id,
            kind: job.kind,
            error: error instanceof Error ? error.name : "UnknownError",
          }),
        );
      }
    } else await setTimeout(2000);
  }
} finally {
  try {
    await connection`select pg_advisory_unlock(834702)`;
  } finally {
    connection.release();
    // An expired reserved connection can leave Postgres.js teardown pending.
    // The current job has finished; bound pool cleanup rather than waiting for SIGKILL.
    await client.end({ timeout: 5 });
  }
}
