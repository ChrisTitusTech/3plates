import "./env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq, sql } from "drizzle-orm";
import { client, db } from "../server/db.js";
import { buildApp } from "../server/app.js";
import {
  budgets,
  jobs,
  members,
  oauthStates,
  records,
  sessions,
} from "../server/schema.js";
import { config } from "../server/config.js";
import { encrypt, hash, randomToken } from "../server/security.js";
import {
  accessToken,
  ApiError,
  ReconnectError,
  reserveRequest,
} from "../server/whoop.js";
import { enqueueSync, processJob, retryJob, upsert } from "../server/sync.js";
const app = await buildApp({ serveStatic: false });
const realFetch = globalThis.fetch;
let memberA: string;
let memberB: string;
let cookieA: string;
let cookieB: string;
const origin = "http://localhost:5173";
const cycle = (id: number, user_id = 1) => ({
  id,
  user_id,
  start: "2026-01-02T08:00:00Z",
  timezone_offset: "-06:00",
  score_state: "SCORED",
  score: { strain: 12 },
});
async function user(whoopId: string, name: string) {
  const [m] = await db
    .insert(members)
    .values({
      whoopId,
      name,
      tokens: encrypt(
        {
          access_token: "access",
          refresh_token: "refresh",
          expires_at: Date.now() + 3600000,
        },
        config.TOKEN_KEY,
      ),
    })
    .returning();
  const token = randomToken();
  await db.insert(sessions).values({
    hash: hash(token),
    memberId: m.id,
    expires: new Date(Date.now() + 3600000),
  });
  return { id: m.id, cookie: `gallant=${token}` };
}
before(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await app.ready();
});
beforeEach(async () => {
  globalThis.fetch = realFetch;
  await db.execute(sql`truncate members, budgets cascade`);
  const a = await user("1", "Member A");
  const b = await user("2", "Member B");
  memberA = a.id;
  cookieA = a.cookie;
  memberB = b.id;
  cookieB = b.cookie;
  await upsert(db, memberA, "cycle", cycle(101));
  await upsert(db, memberB, "cycle", {
    ...cycle(202, 2),
    score: { strain: 20 },
  });
});
after(async () => {
  globalThis.fetch = realFetch;
  await app.close();
  await client.end();
});

test("authentication, date validation, and ownership are enforced by the API", async () => {
  assert.equal((await app.inject("/api/me/dashboard")).statusCode, 401);
  const a = await app.inject({
    url: "/api/me/dashboard?start=2026-01-01&end=2026-01-03",
    headers: { cookie: cookieA },
  });
  const b = await app.inject({
    url: "/api/me/dashboard?start=2026-01-01&end=2026-01-03",
    headers: { cookie: cookieB },
  });
  assert.equal(a.json().summary.strain.value, 12);
  assert.equal(b.json().summary.strain.value, 20);
  assert.equal(a.json().lifetime.metrics.strain.average, 12);
  assert.equal(a.json().exploration[0].strain, 12);
  assert.equal(b.json().exploration[0].strain, 20);
  assert.equal(b.json().lifetime.metrics.strain.average, 20);
  const outside = await app.inject({
    url: "/api/me/dashboard?start=2020-01-01&end=2020-01-02",
    headers: { cookie: cookieA },
  });
  assert.deepEqual(outside.json().lifetime, a.json().lifetime);
  assert.deepEqual(outside.json().exploration, a.json().exploration);
  assert.equal(outside.json().summary.strain.value, null);
  assert.equal(a.json().analytics.calendar[0].strain, 12);
  assert.equal(b.json().analytics.calendar[0].strain, 20);
  assert.equal(a.json().analytics.recovery.length, 3);
  assert.equal(a.json().analytics.sleep.length, 3);
  assert.equal(
    (
      await app.inject({
        url: "/api/me/dashboard?start=2026-02-30",
        headers: { cookie: cookieA },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/me/sharing",
        headers: { cookie: cookieA, origin: "https://attacker.test" },
        payload: { enabled: true },
      })
    ).statusCode,
    403,
  );
});
test("public links are explicit, sanitized, read-only, and immediately revocable", async () => {
  await upsert(db, memberA, "profile", {
    user_id: 1,
    email: "private@example.test",
  });
  const result = await app.inject({
    method: "POST",
    url: "/api/me/sharing",
    headers: { cookie: cookieA, origin },
    payload: { enabled: true },
  });
  const token = result.json().shareUrl.split("/").at(-1);
  const shared = await app.inject(
    `/api/shared/${token}?start=2026-01-01&end=2026-01-03`,
  );
  assert.equal(shared.statusCode, 200);
  assert.equal(shared.json().name, "Member A");
  assert.equal(shared.json().lifetime.metrics.strain.average, 12);
  assert.equal(shared.json().exploration[0].strain, 12);
  assert.equal(shared.json().analytics.calendar[0].strain, 12);
  assert.ok(!shared.body.includes("private@example.test"));
  assert.ok(!shared.body.includes("whoopId"));
  assert.ok(!shared.body.includes("access_token"));
  assert.equal(shared.headers["cache-control"], "no-store");
  assert.equal(shared.headers["x-robots-tag"], "noindex, nofollow, noarchive");
  await app.inject({
    method: "POST",
    url: "/api/me/sharing",
    headers: { cookie: cookieA, origin },
    payload: { enabled: false },
  });
  assert.equal((await app.inject(`/api/shared/${token}`)).statusCode, 404);
});
test("OAuth state is browser-bound, expires, and cannot be replayed", async () => {
  const started = await app.inject("/auth/whoop");
  const state = new URL(started.headers.location!).searchParams.get("state")!;
  const browserCookie = started.cookies[0];
  const cookie = `${browserCookie.name}=${browserCookie.value}`;
  const wrong = await app.inject({
    url: `/callback?state=${state}&error=denied`,
    headers: { cookie: "gallant-oauth=wrong" },
  });
  assert.equal(wrong.statusCode, 400);
  const rejected = await app.inject({
    url: `/callback?state=${state}&error=denied`,
    headers: { cookie },
  });
  assert.equal(rejected.statusCode, 302);
  assert.equal(
    (
      await app.inject({
        url: `/callback?state=${state}&error=denied`,
        headers: { cookie },
      })
    ).statusCode,
    400,
  );
  const expired = await app.inject("/auth/whoop");
  const expiredState = new URL(expired.headers.location!).searchParams.get(
    "state",
  )!;
  await db
    .update(oauthStates)
    .set({ expires: new Date(0) })
    .where(eq(oauthStates.hash, hash(expiredState)));
  assert.equal(
    (
      await app.inject({
        url: `/callback?state=${expiredState}&error=denied`,
        headers: {
          cookie: `${expired.cookies[0].name}=${expired.cookies[0].value}`,
        },
      })
    ).statusCode,
    400,
  );
});
test("OAuth callback imports the authenticated identity and rotates the local session", async () => {
  globalThis.fetch = async (input) =>
    String(input).includes("/token")
      ? Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        })
      : Response.json({ user_id: 1, first_name: "Member", last_name: "A" });
  const start = await app.inject({
    url: "/auth/whoop",
    headers: { cookie: cookieA },
  });
  const state = new URL(start.headers.location!).searchParams.get("state");
  const result = await app.inject({
    url: `/callback?state=${state}&code=valid`,
    headers: {
      cookie: cookieA + `; ${start.cookies[0].name}=${start.cookies[0].value}`,
    },
  });
  assert.equal(result.statusCode, 302);
  assert.ok(result.cookies.some((c) => c.name === "gallant" && c.httpOnly));
  assert.equal(
    (await app.inject({ url: "/api/me", headers: { cookie: cookieA } }))
      .statusCode,
    401,
  );
  const queued = await db.select().from(jobs).where(eq(jobs.memberId, memberA));
  assert.equal(queued.length, 6);
});
test("refresh rotation is serialized across concurrent requests and revocation pauses the account", async () => {
  await db
    .update(members)
    .set({
      tokens: encrypt(
        { access_token: "old", refresh_token: "refresh", expires_at: 0 },
        config.TOKEN_KEY,
      ),
    })
    .where(eq(members.id, memberA));
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      access_token: "rotated",
      refresh_token: "rotated-refresh",
      expires_in: 3600,
    });
  };
  assert.deepEqual(
    await Promise.all([accessToken(memberA), accessToken(memberA)]),
    ["rotated", "rotated"],
  );
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Response("", { status: 400 });
  await assert.rejects(accessToken(memberA, "rotated"), ReconnectError);
  const [m] = await db.select().from(members).where(eq(members.id, memberA));
  assert.equal(m.connected, false);
  assert.equal(m.tokens, null);
});
test("pagination checkpoints survive retries and upserts do not duplicate data", async () => {
  await enqueueSync(db, memberA, "full");
  let [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.memberId, memberA), eq(jobs.kind, "cycle")));
  await processJob(job, async () => ({
    records: [cycle(101), cycle(102)],
    next_token: "page2",
  }));
  [job] = await db.select().from(jobs).where(eq(jobs.id, job.id));
  assert.equal(job.payload.next, "page2");
  assert.equal(job.count, 2);
  await retryJob(job, new ApiError(429, 120));
  [job] = await db.select().from(jobs).where(eq(jobs.id, job.id));
  assert.equal(job.attempts, 0);
  assert.equal(job.payload.next, "page2");
  await processJob(job, async (_member, path) => {
    assert.ok(path.includes("nextToken=page2"));
    return { records: [cycle(102), cycle(103)], next_token: null };
  });
  const rs = await db
    .select()
    .from(records)
    .where(and(eq(records.memberId, memberA), eq(records.kind, "cycle")));
  assert.equal(rs.length, 3);
  [job] = await db.select().from(jobs).where(eq(jobs.id, job.id));
  assert.equal(job.status, "done");
});
test("complete reconciliation removes missing historical records but protects fresh updates", async () => {
  await db
    .update(records)
    .set({ fetchedAt: new Date("2020-01-01") })
    .where(eq(records.memberId, memberA));
  await enqueueSync(db, memberA, "full");
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.memberId, memberA), eq(jobs.kind, "cycle")));
  await upsert(db, memberA, "cycle", cycle(102));
  await processJob(job, async () => ({ records: [], next_token: null }));
  const rs = await db
    .select()
    .from(records)
    .where(eq(records.memberId, memberA));
  assert.equal(rs.find((r) => r.sourceId === "101")!.deleted, true);
  assert.equal(rs.find((r) => r.sourceId === "102")!.deleted, false);
});
test("webhooks validate signatures, deduplicate, and recover v2 recovery IDs through sleep", async () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const event = {
    user_id: 1,
    id,
    type: "recovery.updated",
    trace_id: "test-trace",
  };
  const payload = JSON.stringify(event);
  const timestamp = String(Date.now());
  const headers = {
    "content-type": "application/json",
    "x-whoop-signature-timestamp": timestamp,
    "x-whoop-signature": createHmac("sha256", config.ClientSecret)
      .update(timestamp + payload)
      .digest("base64"),
  };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/webhooks/whoop",
        headers: { ...headers, "x-whoop-signature": "wrong" },
        payload,
      })
    ).statusCode,
    401,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/webhooks/whoop",
          headers,
          payload,
        })
      ).statusCode,
      204,
    );
  const events = await db.select().from(jobs).where(eq(jobs.kind, "event"));
  assert.equal(events.length, 1);
  const paths: string[] = [];
  await processJob(events[0], async (_m, path) => {
    paths.push(path);
    return path.includes("/activity/sleep/")
      ? { cycle_id: 101 }
      : path.endsWith("/recovery")
        ? {
            user_id: 1,
            cycle_id: 101,
            sleep_id: id,
            score_state: "SCORED",
            score: { recovery_score: 77 },
          }
        : cycle(101);
  });
  assert.ok(paths.includes("/cycle/101/recovery"));
  const [recovery] = await db
    .select()
    .from(records)
    .where(and(eq(records.memberId, memberA), eq(records.kind, "recovery")));
  assert.equal(recovery.sleepId, id);
});
test("deletion events remove both sleep and associated recovery after WHOOP confirms absence", async () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  await upsert(db, memberA, "sleep", {
    id,
    cycle_id: 101,
    start: "2026-01-01T23:00:00Z",
    end: "2026-01-02T08:00:00Z",
  });
  await upsert(db, memberA, "recovery", { cycle_id: 101, sleep_id: id });
  const [job] = await db
    .insert(jobs)
    .values({
      memberId: memberA,
      key: "delete",
      kind: "event",
      payload: { id, type: "sleep.deleted" },
    })
    .returning();
  await processJob(job, async () => {
    throw new ApiError(404);
  });
  const rs = await db
    .select()
    .from(records)
    .where(and(eq(records.memberId, memberA), eq(records.sleepId, id)));
  assert.equal(rs.length, 2);
  assert.ok(rs.every((r) => r.deleted));
});
test("shared global budget defers requests across processes", async () => {
  await db
    .insert(budgets)
    .values({ key: "minute", count: 60, resets: new Date(Date.now() + 30000) });
  await assert.rejects(
    reserveRequest(),
    (e) => e instanceof ApiError && e.status === 429 && e.delay >= 29,
  );
});
test("disconnect revokes sharing, cancels jobs, retains history; deletion removes all member data", async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });
  await db
    .update(members)
    .set({ shareToken: "x".repeat(43) })
    .where(eq(members.id, memberA));
  await enqueueSync(db, memberA, "full");
  const response = await app.inject({
    method: "POST",
    url: "/api/me/disconnect",
    headers: { cookie: cookieA, origin },
    payload: {},
  });
  assert.equal(response.statusCode, 200);
  const [m] = await db.select().from(members).where(eq(members.id, memberA));
  assert.equal(m.tokens, null);
  assert.equal(m.shareToken, null);
  assert.equal(
    (await db.select().from(jobs).where(eq(jobs.memberId, memberA))).length,
    0,
  );
  assert.equal(
    (await db.select().from(records).where(eq(records.memberId, memberA)))
      .length,
    1,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: "/api/me",
        headers: { cookie: cookieA, origin },
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: "/api/me", headers: { cookie: cookieA } }))
      .statusCode,
    401,
  );
  assert.equal(
    (await db.select().from(records).where(eq(records.memberId, memberA)))
      .length,
    0,
  );
  assert.equal(
    (await app.inject({ url: "/api/me", headers: { cookie: cookieB } }))
      .statusCode,
    200,
  );
});

test("production static serving keeps sharing pages uncached and rejects unknown paths", async () => {
  const server = await buildApp({ serveStatic: true });
  try {
    const share = await server.inject("/share/" + "x".repeat(43));
    assert.equal(share.statusCode, 200);
    assert.equal(share.headers["cache-control"], "no-store");
    assert.equal(share.headers["x-robots-tag"], "noindex, nofollow, noarchive");
    assert.equal((await server.inject("/.env")).statusCode, 404);
    for (const path of [
      "/%2e%2e/%2e%2e/.env",
      "/assets/..%2f..%2f.env",
      "/assets/%2e%2e%5c.env",
    ]) {
      const response = await server.inject(path);
      assert.ok(
        [400, 403, 404].includes(response.statusCode),
        `non-canonical private path must be rejected: ${path}`,
      );
    }
    assert.equal((await server.inject("/unexpected-page")).statusCode, 404);
  } finally {
    await server.close();
  }
});

test(
  "worker exits cleanly after its reserved connection lifetime expires",
  { timeout: 20000 },
  async () => {
    await db.update(members).set({ connected: false });
    const worker = spawn(
      process.execPath,
      ["--import", "tsx", "server/worker.ts"],
      {
        env: { ...process.env, PGMAX_LIFETIME: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    worker.stdout.on("data", (data) => {
      output += data;
    });
    worker.stderr.on("data", (data) => {
      output += data;
    });
    const exited = new Promise<{ code: number | null; signal: string | null }>(
      (resolve) =>
        worker.once("exit", (code, signal) => resolve({ code, signal })),
    );
    try {
      for (let i = 0; i < 100 && !output.includes("WHOOP worker started"); i++)
        await sleep(50);
      assert.match(output, /WHOOP worker started/);
      await sleep(1500);
      worker.kill("SIGTERM");
      const result = await Promise.race([
        exited,
        sleep(10000, null, { ref: false }),
      ]);
      assert.deepEqual(
        result,
        { code: 0, signal: null },
        "expired reserved connection must close without systemd SIGKILL",
      );
      await db.transaction(async (tx) => {
        const [lock] = await tx.execute(
          sql`select pg_try_advisory_xact_lock(834702) as acquired`,
        );
        assert.equal(
          lock.acquired,
          true,
          "a replacement worker must be able to acquire the singleton lock",
        );
      });
    } finally {
      if (worker.exitCode === null && worker.signalCode === null)
        worker.kill("SIGKILL");
      await exited;
    }
  },
);

test("context reuse invalidates on edits and deletion; restricted shares enforce all projections and expiry", async () => {
  const get = async (extra = "") =>
    (
      await app.inject({
        url: "/api/me/dashboard?start=2026-01-01&end=2026-01-03" + extra,
        headers: { cookie: cookieA },
      })
    ).json();
  const initial = await get();
  const reused = await get("&context=" + initial.contextVersion);
  assert.equal(reused.lifetime, undefined);
  assert.equal(reused.exploration, undefined);
  assert.equal(reused.analytics.calendar, undefined);
  assert.equal(reused.summary.strain.value, 12);
  await upsert(db, memberA, "cycle", { ...cycle(101), score: { strain: 5 } });
  const changed = await get("&context=" + initial.contextVersion);
  assert.equal(changed.lifetime.metrics.strain.average, 5);
  assert.notEqual(changed.contextVersion, initial.contextVersion);
  await db
    .update(records)
    .set({ deleted: true })
    .where(eq(records.memberId, memberA));
  const removed = await get("&context=" + changed.contextVersion);
  assert.equal(removed.lifetime.metrics.strain.count, 0);
  await upsert(db, memberA, "cycle", cycle(101));
  await upsert(db, memberA, "sleep", {
    id: "s",
    cycle_id: 101,
    start: "2026-01-02T08:00:00Z",
    end: "2026-01-02T14:00:00Z",
    score_state: "SCORED",
    score: { sleep_performance_percentage: 95 },
  });
  const sharedResult = await app.inject({
    method: "POST",
    url: "/api/me/sharing",
    headers: { cookie: cookieA, origin },
    payload: {
      enabled: true,
      policy: {
        kinds: ["sleep"],
        start: "2026-01-02",
        end: "2026-01-02",
        expires: new Date(Date.now() + 86400000).toISOString(),
      },
    },
  });
  assert.equal(sharedResult.statusCode, 200);
  const token = sharedResult.json().shareUrl.split("/").at(-1);
  const response = await app.inject(
    "/api/shared/" + token + "?start=2026-01-01&end=2026-01-03",
  );
  const view = response.json();
  assert.equal(view.summary.strain.value, null);
  assert.equal(view.lifetime.metrics.strain.count, 0);
  assert.equal(view.summary.sleep.value, 95);
  assert.equal(view.body, null);
  assert.ok(
    view.details.every(
      (d: any) => d.kind === "sleep" && d.date === "2026-01-02",
    ),
  );
  assert.ok(
    view.exploration.every(
      (d: any) => d.strain === null && d.recovery === null,
    ),
  );
  await db
    .update(members)
    .set({ sharePolicy: { kinds: ["sleep"], expires: "2020-01-01T00:00:00Z" } })
    .where(eq(members.id, memberA));
  assert.equal((await app.inject("/api/shared/" + token)).statusCode, 404);
});

test("hashed assets cache immutably while errors and personal responses remain uncached", async () => {
  const staticApp = await buildApp({ serveStatic: true });
  try {
    const { readdir } = await import("node:fs/promises");
    const asset = (await readdir("dist/web/assets")).find((n) =>
      n.endsWith(".js"),
    )!;
    const response = await staticApp.inject("/assets/" + asset);
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers["cache-control"],
      "public, max-age=31536000, immutable",
    );
    assert.equal(
      (await staticApp.inject("/assets/missing-123.js")).headers[
        "cache-control"
      ],
      "no-store",
    );
    assert.equal(
      (await staticApp.inject("/api/me/dashboard")).headers["cache-control"],
      "no-store",
    );
  } finally {
    await staticApp.close();
  }
});
