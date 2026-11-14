import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db.js";
import { jobs, members, records } from "./schema.js";
import { endpoints, historyKinds, normalize, type Raw } from "./domain.js";
import { ApiError, ReconnectError, requestWhoop } from "./whoop.js";

type Database = Pick<
  typeof db,
  "select" | "insert" | "update" | "delete" | "execute"
>;
export async function enqueue(
  tx: Database,
  memberId: string,
  kind: string,
  payload: Raw,
  key: string,
  priority = 10,
) {
  await tx
    .update(jobs)
    .set({ status: "superseded" })
    .where(
      and(
        eq(jobs.memberId, memberId),
        eq(jobs.key, key),
        eq(jobs.status, "failed"),
      ),
    );
  await tx
    .insert(jobs)
    .values({ memberId, kind, payload, key, priority })
    .onConflictDoNothing();
}
export async function enqueueSync(
  tx: Database,
  memberId: string,
  mode: "full" | "recent" | "cycle",
) {
  const end = new Date().toISOString();
  const start =
    mode === "full"
      ? undefined
      : new Date(Date.now() - 14 * 86400000).toISOString();
  for (const kind of mode === "cycle"
    ? ["cycle"]
    : [...historyKinds, "profile", "body"]) {
    await enqueue(
      tx,
      memberId,
      kind,
      { mode, start, end },
      `sync:${kind}:${mode}`,
      mode === "full" ? 20 : 5,
    );
  }
}
export async function upsert(
  tx: Database,
  memberId: string,
  kind: string,
  raw: Raw,
) {
  const row = normalize(kind, raw);
  await tx
    .insert(records)
    .values({ ...row, memberId })
    .onConflictDoUpdate({
      target: [records.memberId, records.kind, records.sourceId],
      set: { ...row, fetchedAt: new Date(), deleted: false },
    });
}
const pageSchema = z.object({
  records: z.array(z.record(z.string(), z.any())),
  next_token: z.string().nullish(),
});
export async function processJob(
  job: typeof jobs.$inferSelect,
  api = requestWhoop,
) {
  if (job.kind === "event") return processEvent(job, api);
  const isCollection = historyKinds.includes(
    job.kind as (typeof historyKinds)[number],
  );
  const query = new URLSearchParams({ limit: "25", end: job.payload.end });
  if (job.payload.start) query.set("start", job.payload.start);
  if (job.payload.next) query.set("nextToken", job.payload.next);
  const response = await api(
    job.memberId,
    endpoints[job.kind] + (isCollection ? "?" + query : ""),
  );
  const page = isCollection
    ? pageSchema.parse(response)
    : { records: [response], next_token: null };
  if (page.next_token && page.next_token === job.payload.next)
    throw new Error("WHOOP returned a repeated pagination cursor");
  await db.transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(members)
      .where(eq(members.id, job.memberId))
      .for("update");
    if (!member?.connected) {
      await tx.delete(jobs).where(eq(jobs.id, job.id));
      return;
    }
    for (const raw of page.records) {
      if (raw.user_id != null && String(raw.user_id) !== member.whoopId)
        throw new Error("WHOOP returned a mismatched member");
      await upsert(tx, job.memberId, job.kind, raw);
    }
    await tx
      .update(jobs)
      .set({
        status: page.next_token ? "pending" : "done",
        payload: { ...job.payload, next: page.next_token },
        count: job.count + page.records.length,
        attempts: 0,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
    if (!page.next_token && job.payload.mode === "full" && isCollection) {
      // Only a complete full traversal can infer deletions. Concurrent fresh imports are protected.
      await tx
        .update(records)
        .set({ deleted: true })
        .where(
          and(
            eq(records.memberId, job.memberId),
            eq(records.kind, job.kind),
            lt(records.fetchedAt, job.startedAt),
            lt(records.start, new Date(job.payload.end)),
          ),
        );
    }
    await tx
      .update(members)
      .set({ lastSync: new Date() })
      .where(eq(members.id, job.memberId));
  });
}
async function processEvent(
  job: typeof jobs.$inferSelect,
  api: typeof requestWhoop,
) {
  const { type, id } = job.payload as { type: string; id: string };
  const kind = type.split(".")[0];
  let raw: Raw | null = null;
  let cycle: Raw | null = null;
  try {
    if (kind === "recovery") {
      const sleep = await api(
        job.memberId,
        "/activity/sleep/" + encodeURIComponent(id),
      );
      raw = await api(
        job.memberId,
        `/cycle/${encodeURIComponent(sleep.cycle_id)}/recovery`,
      );
      cycle = await api(
        job.memberId,
        `/cycle/${encodeURIComponent(sleep.cycle_id)}`,
      );
    } else
      raw = await api(
        job.memberId,
        `/activity/${kind}/${encodeURIComponent(id)}`,
      );
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  // Fetching current state, even for deletion events, prevents delayed deliveries from overwriting newer state.
  await db.transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(members)
      .where(eq(members.id, job.memberId))
      .for("update");
    if (!member?.connected) {
      await tx.delete(jobs).where(eq(jobs.id, job.id));
      return;
    }
    if (raw) {
      if (String(raw.user_id) !== member.whoopId)
        throw new Error("WHOOP returned a mismatched member");
      await upsert(tx, job.memberId, kind, raw);
      if (cycle) await upsert(tx, job.memberId, "cycle", cycle);
    } else {
      await tx
        .update(records)
        .set({ deleted: true, fetchedAt: new Date() })
        .where(
          and(
            eq(records.memberId, job.memberId),
            eq(records.kind, kind),
            kind === "recovery"
              ? eq(records.sleepId, id)
              : eq(records.sourceId, id),
          ),
        );
      if (kind === "sleep")
        await tx
          .update(records)
          .set({ deleted: true, fetchedAt: new Date() })
          .where(
            and(
              eq(records.memberId, job.memberId),
              eq(records.kind, "recovery"),
              eq(records.sleepId, id),
            ),
          );
    }
    await tx
      .update(jobs)
      .set({ status: "done", updatedAt: new Date(), error: null })
      .where(eq(jobs.id, job.id));
    await enqueueSync(tx, job.memberId, "cycle");
    await tx
      .update(members)
      .set({ lastSync: new Date() })
      .where(eq(members.id, job.memberId));
  });
}
export async function retryJob(job: typeof jobs.$inferSelect, error: unknown) {
  const deferred = error instanceof ApiError && error.status === 429;
  const attempts = deferred ? job.attempts : job.attempts + 1;
  const terminal =
    error instanceof ReconnectError || (!deferred && attempts >= 8);
  const delay = deferred
    ? error.delay
    : Math.min(3600, 2 ** attempts * 15) + Math.floor(Math.random() * 10);
  await db
    .update(jobs)
    .set({
      status: terminal ? "failed" : "pending",
      attempts,
      availableAt: new Date(Date.now() + delay * 1000),
      updatedAt: new Date(),
      error:
        error instanceof ReconnectError
          ? error.message
          : error instanceof ApiError
            ? error.message
            : "Import failed; a retry may be required.",
    })
    .where(eq(jobs.id, job.id));
}
export async function schedule() {
  const connected = await db
    .select()
    .from(members)
    .where(eq(members.connected, true));
  for (const member of connected) {
    await db.transaction(async (tx) => {
      const [m] = await tx
        .select()
        .from(members)
        .where(eq(members.id, member.id))
        .for("update");
      if (!m?.connected) return;
      const now = new Date();
      const due = (date: Date | null, interval: number) =>
        !date || now.getTime() - date.getTime() >= interval;
      if (due(m.lastFull, 7 * 86400000)) {
        await enqueueSync(tx, m.id, "full");
        await tx
          .update(members)
          .set({ lastFull: now })
          .where(eq(members.id, m.id));
      }
      if (due(m.lastRecent, 86400000)) {
        await enqueueSync(tx, m.id, "recent");
        await tx
          .update(members)
          .set({ lastRecent: now })
          .where(eq(members.id, m.id));
      }
      if (due(m.lastCycle, 3600000)) {
        await enqueueSync(tx, m.id, "cycle");
        await tx
          .update(members)
          .set({ lastCycle: now })
          .where(eq(members.id, m.id));
      }
    });
  }
  await db
    .delete(jobs)
    .where(
      and(
        inArray(jobs.status, ["done", "superseded"]),
        lt(jobs.updatedAt, new Date(Date.now() - 14 * 86400000)),
      ),
    );
}
export async function claimJob() {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), sql`${jobs.availableAt} <= now()`))
      .orderBy(jobs.priority, jobs.updatedAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return null;
    await tx
      .update(jobs)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(jobs.id, job.id));
    return job;
  });
}
