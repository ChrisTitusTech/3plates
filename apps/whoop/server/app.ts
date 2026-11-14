import {
  createHistoryCache,
  completeness,
  type SharePolicy,
} from "./history.js";
import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import rawBody from "fastify-raw-body";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { config, origin, scopes } from "./config.js";
import { db } from "./db.js";
import {
  heartbeat,
  jobs,
  members,
  oauthStates,
  records,
  sessions,
  webhooks,
} from "./schema.js";
import {
  csvCell,
  encrypt,
  hash,
  randomToken,
  redactedPath,
  validSignature,
} from "./security.js";
import { sleepAnalytics, recoveryAnalytics } from "./analytics.js";
import { bucket, daily, makeDetails, summarize } from "./domain.js";
import { enqueue, enqueueSync } from "./sync.js";
import {
  ApiError,
  ReconnectError,
  requestWhoop,
  reserveRequest,
  tokenRequest,
} from "./whoop.js";

const safeDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (d) =>
      Number.isFinite(Date.parse(d)) &&
      new Date(d).toISOString().slice(0, 10) === d,
  );
const dateQuery = z.object({
  start: safeDate.optional(),
  end: safeDate.optional(),
  context: z.string().max(200).optional(),
});
const cookieOptions = {
  path: "/",
  httpOnly: true,
  secure: config.NODE_ENV === "production",
  sameSite: "lax" as const,
};
const sessionName =
  config.NODE_ENV === "production" ? "__Host-gallant" : "gallant";
const fail = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });
async function memberFor(request: FastifyRequest) {
  const token = request.cookies[sessionName];
  if (!token) return null;
  const [row] = await db
    .select({ member: members })
    .from(sessions)
    .innerJoin(members, eq(sessions.memberId, members.id))
    .where(
      and(eq(sessions.hash, hash(token)), gt(sessions.expires, new Date())),
    );
  return row?.member ?? null;
}
async function requireMember(request: FastifyRequest) {
  const member = await memberFor(request);
  if (!member) throw fail(401, "Sign in to view your dashboard.");
  return member;
}
const cachedHistory = createHistoryCache();
async function dashboard(
  member: typeof members.$inferSelect,
  query: unknown,
  policy?: SharePolicy | null,
) {
  const {
    start = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    end = new Date().toISOString().slice(0, 10),
    context,
  } = dateQuery.parse(query);
  const span = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  if (span < 1 || span > 20000)
    throw fail(400, "Select a valid date range of at most 20,000 days.");
  const contextVersion =
    member.dataRevision +
    "-" +
    hash(member.id + JSON.stringify(policy ?? null));
  const saved = await cachedHistory(
    member.id + ":" + hash(JSON.stringify(policy ?? null)),
    member.dataRevision,
    () =>
      db
        .select()
        .from(records)
        .where(
          and(eq(records.memberId, member.id), eq(records.deleted, false)),
        ),
    policy,
  );
  const { details, history } = saved;
  const previousEnd = new Date(Date.parse(start) - 86400000)
    .toISOString()
    .slice(0, 10);
  const previousStart = new Date(Date.parse(start) - span * 86400000)
    .toISOString()
    .slice(0, 10);
  const days = daily(history, previousStart, end);
  const current = days.filter((d) => d.date >= start);
  const previous = days.filter((d) => d.date < start);
  const chart = bucket(current);
  return {
    contextVersion,
    completeness: completeness(
      history,
      current.map((d) => d.date),
    ),
    analytics: {
      sleep: sleepAnalytics(history, start, end),
      recovery: recoveryAnalytics(
        daily(
          history,
          new Date(Date.parse(start) - 28 * 86400000)
            .toISOString()
            .slice(0, 10),
          end,
        ),
      ).filter((d) => d.date >= start),
      ...(context === contextVersion ? {} : { calendar: saved.calendar }),
    },
    ...(context === contextVersion
      ? {}
      : { lifetime: saved.lifetime, exploration: saved.exploration }),
    name: member.name,
    start,
    end,
    earliest: saved.earliest,
    latest: saved.latest,
    lastSync: member.lastSync,
    summary: summarize(current),
    previous: summarize(previous),
    previousStart,
    previousEnd,
    days: current,
    chart,
    details: details.filter(
      (d) => d.date >= start && d.date <= end && d.kind !== "body",
    ),
    body:
      details
        .filter((d) => d.kind === "body")
        .sort((a, b) => b.start.localeCompare(a.start))[0] ?? null,
  };
}
export async function buildApp(
  options: { logger?: boolean; serveStatic?: boolean } = {},
) {
  const app = Fastify({
    logger: options.logger
      ? {
          level: "info",
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            'res.headers["set-cookie"]',
          ],
          serializers: {
            req: (r) => ({
              method: r.method,
              path: redactedPath(r.url ?? ""),
              remoteAddress: r.ip,
            }),
          },
        }
      : false,
    trustProxy: ["127.0.0.1", "::1"],
    bodyLimit: 65536,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header(
        "Cache-Control",
        /^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.(?:js|css)$/.test(
          req.url.split("?")[0],
        )
          ? "public, max-age=31536000, immutable"
          : "no-store",
      )
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.url.startsWith("/share/") || req.url.startsWith("/api/shared/"))
      reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      req.url.split("?")[0] !== "/api/webhooks/whoop"
    ) {
      if (req.headers.origin !== origin)
        throw fail(403, "Request origin was not accepted.");
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw fail(415, "JSON is required.");
    }
  });
  app.addHook("onSend", async (_req, reply, payload) => {
    if (reply.statusCode >= 400) reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: "Invalid request or upstream data." });
    if (error instanceof ReconnectError)
      return reply.code(409).send({ error: error.message });
    if (error instanceof ApiError)
      return reply
        .code(503)
        .send({ error: "WHOOP is temporarily unavailable. Please retry." });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500)
      app.log.error(
        {
          event: "request_failed",
          errorType: error instanceof Error ? error.name : "UnknownError",
        },
        "Request failed",
      );
    return reply.code(status).send({
      error:
        status >= 500
          ? "The request could not be completed."
          : error instanceof Error
            ? error.message
            : "Request failed",
    });
  });
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_req, reply) => {
    await db.execute(sql`select 1`);
    const [worker] = await db
      .select()
      .from(heartbeat)
      .where(eq(heartbeat.name, "worker"));
    const healthy = worker && Date.now() - worker.at.getTime() < 180000;
    return reply
      .code(healthy ? 200 : 503)
      .send({ status: healthy ? "ready" : "worker-unavailable" });
  });
  app.get(
    "/auth/whoop",
    { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const state = randomToken();
      const browser = randomToken();
      const member = await memberFor(req);
      await db.insert(oauthStates).values({
        hash: hash(state),
        browserHash: hash(browser),
        memberId: member?.id,
        expires: new Date(Date.now() + 600000),
      });
      reply.setCookie("gallant-oauth", browser, {
        ...cookieOptions,
        maxAge: 600,
      });
      const params = new URLSearchParams({
        client_id: config.ClientID,
        redirect_uri: origin + "/callback",
        response_type: "code",
        scope: scopes,
        state,
      });
      return reply.redirect(
        "https://api.prod.whoop.com/oauth/oauth2/auth?" + params,
      );
    },
  );
  app.get("/callback", async (req, reply) => {
    const q = z
      .object({
        state: z.string().min(8),
        code: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(req.query);
    const browser = req.cookies["gallant-oauth"];
    if (!browser) throw fail(400, "This sign-in expired. Start again.");
    const [transaction] = await db
      .delete(oauthStates)
      .where(
        and(
          eq(oauthStates.hash, hash(q.state)),
          eq(oauthStates.browserHash, hash(browser)),
          gt(oauthStates.expires, new Date()),
        ),
      )
      .returning();
    reply.clearCookie("gallant-oauth", cookieOptions);
    if (!transaction)
      throw fail(400, "This sign-in expired or was already used. Start again.");
    if (q.error || !q.code)
      return reply.redirect("/?notice=authorization-declined");
    await reserveRequest();
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      code: q.code,
      redirect_uri: origin + "/callback",
    });
    await reserveRequest();
    const response = await fetch(
      "https://api.prod.whoop.com/developer/v2/user/profile/basic",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw new ApiError(response.status);
    const profile = z
      .object({
        user_id: z.number().int(),
        first_name: z.string(),
        last_name: z.string(),
        email: z.string().optional(),
      })
      .parse(await response.json());
    const token = randomToken();
    await db.transaction(async (tx) => {
      if (transaction.memberId) {
        const [existing] = await tx
          .select()
          .from(members)
          .where(eq(members.id, transaction.memberId))
          .for("update");
        if (!existing || existing.whoopId !== String(profile.user_id))
          throw fail(
            409,
            "Reconnect with the same WHOOP account, or sign out first.",
          );
      }
      const now = new Date();
      const [member] = await tx
        .insert(members)
        .values({
          whoopId: String(profile.user_id),
          name: [profile.first_name, profile.last_name].join(" ").trim(),
          email: profile.email,
          tokens: encrypt(tokens, config.TOKEN_KEY),
          lastFull: now,
          lastRecent: now,
          lastCycle: now,
        })
        .onConflictDoUpdate({
          target: members.whoopId,
          set: {
            name: [profile.first_name, profile.last_name].join(" ").trim(),
            email: profile.email,
            tokens: encrypt(tokens, config.TOKEN_KEY),
            connected: true,
            lastFull: now,
            lastRecent: now,
            lastCycle: now,
          },
        })
        .returning();
      await tx.insert(sessions).values({
        hash: hash(token),
        memberId: member.id,
        expires: new Date(Date.now() + 30 * 86400000),
      });
      const old = req.cookies[sessionName];
      if (old) await tx.delete(sessions).where(eq(sessions.hash, hash(old)));
      await enqueueSync(tx, member.id, "full");
    });
    return reply
      .setCookie(sessionName, token, { ...cookieOptions, maxAge: 30 * 86400 })
      .redirect("/");
  });
  app.get("/api/me", async (req) => {
    const m = await requireMember(req);
    return {
      name: m.name,
      connected: m.connected,
      shareUrl: m.shareToken ? origin + "/share/" + m.shareToken : null,
      sharePolicy: m.sharePolicy,
    };
  });
  app.get("/api/me/dashboard", async (req) =>
    dashboard(await requireMember(req), req.query),
  );
  app.get("/api/me/sync", async (req) => {
    const m = await requireMember(req);
    const rows = await db
      .select({
        kind: jobs.kind,
        status: jobs.status,
        count: jobs.count,
        error: jobs.error,
        updatedAt: jobs.updatedAt,
        mode: sql<string>`${jobs.payload}->>'mode'`,
      })
      .from(jobs)
      .where(eq(jobs.memberId, m.id))
      .orderBy(desc(jobs.updatedAt))
      .limit(100);
    const lastSuccessful = await db
      .select({ kind: jobs.kind, at: sql<string>`max(${jobs.updatedAt})` })
      .from(jobs)
      .where(and(eq(jobs.memberId, m.id), eq(jobs.status, "done")))
      .groupBy(jobs.kind);
    return {
      connected: m.connected,
      lastSync: m.lastSync,
      jobs: rows,
      lastSuccessful,
    };
  });
  app.post(
    "/api/me/sync",
    { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } },
    async (req) => {
      const m = await requireMember(req);
      if (!m.connected) throw fail(409, "Reconnect WHOOP before syncing.");
      const { full = false } = z
        .object({ full: z.boolean().optional() })
        .parse(req.body);
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(members)
          .where(eq(members.id, m.id))
          .for("update");
        if (!current?.connected)
          throw fail(409, "Reconnect WHOOP before syncing.");
        await enqueueSync(tx, m.id, full ? "full" : "recent");
      });
      return { queued: true };
    },
  );
  app.post("/api/me/sharing", async (req) => {
    const m = await requireMember(req);
    const { enabled, policy } = z
      .object({
        enabled: z.boolean(),
        policy: z
          .object({
            kinds: z
              .array(z.enum(["cycle", "sleep", "recovery", "workout", "body"]))
              .min(1),
            start: safeDate.optional(),
            end: safeDate.optional(),
            expires: z.string().datetime().optional(),
          })
          .refine((p) => !p.start || !p.end || p.start <= p.end)
          .optional(),
      })
      .parse(req.body);
    if (enabled && policy?.expires && Date.parse(policy.expires) <= Date.now())
      throw fail(400, "Expiration must be in the future.");
    if (enabled && !m.connected)
      throw fail(409, "Reconnect WHOOP before enabling sharing.");
    const shareToken = enabled ? (m.shareToken ?? randomToken()) : null;
    const updated = await db
      .update(members)
      .set({
        shareToken,
        ...(enabled && policy ? { sharePolicy: policy } : {}),
      })
      .where(
        and(
          eq(members.id, m.id),
          enabled ? eq(members.connected, true) : undefined,
        ),
      )
      .returning({ id: members.id });
    if (!updated.length)
      throw fail(409, "Reconnect WHOOP before enabling sharing.");
    return { shareUrl: shareToken ? origin + "/share/" + shareToken : null };
  });
  app.get("/api/shared/:token", async (req) => {
    const { token } = z
      .object({ token: z.string().min(40).max(100) })
      .parse(req.params);
    const [m] = await db
      .select()
      .from(members)
      .where(eq(members.shareToken, token));
    if (!m) throw fail(404, "This shared dashboard is unavailable.");
    if (
      m.sharePolicy?.expires &&
      Date.parse(m.sharePolicy.expires) <= Date.now()
    )
      throw fail(404, "This shared dashboard is unavailable.");
    return dashboard(m, req.query, m.sharePolicy);
  });
  app.get("/api/me/export", async (req, reply) => {
    const m = await requireMember(req);
    const { format } = z
      .object({ format: z.enum(["json", "csv"]) })
      .parse(req.query);
    const rows = await db
      .select()
      .from(records)
      .where(and(eq(records.memberId, m.id), eq(records.deleted, false)))
      .orderBy(records.start);
    reply.header(
      "Content-Disposition",
      `attachment; filename="gallant-history.${format}"`,
    );
    if (format === "json")
      return {
        exportedAt: new Date().toISOString(),
        records: rows.map((r) => ({ kind: r.kind, data: r.raw })),
      };
    const details = makeDetails(rows);
    const fields = [
      ...new Set(details.flatMap((r) => Object.keys(r.metrics))),
    ].sort();
    const header = [
      "date",
      "kind",
      "start",
      "end",
      "state",
      "nap",
      "sport",
      ...fields,
    ];
    return reply
      .type("text/csv; charset=utf-8")
      .send(
        [
          header.map(csvCell).join(","),
          ...details.map((r) =>
            [
              r.date,
              r.kind,
              r.start,
              r.end,
              r.state,
              r.nap,
              r.sport,
              ...fields.map((k) => r.metrics[k]),
            ]
              .map(csvCell)
              .join(","),
          ),
        ].join("\r\n"),
      );
  });
  app.post("/api/me/disconnect", async (req) => {
    const m = await requireMember(req);
    if (m.connected) {
      try {
        await requestWhoop(m.id, "/user/access", "DELETE");
      } catch (e) {
        if (!(e instanceof ReconnectError)) throw e;
      }
    }
    await db.transaction(async (tx) => {
      await tx
        .update(members)
        .set({ connected: false, tokens: null, shareToken: null })
        .where(eq(members.id, m.id));
      await tx.delete(jobs).where(eq(jobs.memberId, m.id));
    });
    return { disconnected: true };
  });
  app.delete("/api/me", async (req, reply) => {
    const m = await requireMember(req);
    if (m.connected) {
      try {
        await requestWhoop(m.id, "/user/access", "DELETE");
      } catch (e) {
        if (!(e instanceof ReconnectError)) throw e;
      }
    }
    await db.delete(members).where(eq(members.id, m.id));
    reply.clearCookie(sessionName, cookieOptions);
    return { deleted: true };
  });
  app.post("/api/logout", async (req, reply) => {
    const token = req.cookies[sessionName];
    if (token) await db.delete(sessions).where(eq(sessions.hash, hash(token)));
    reply.clearCookie(sessionName, cookieOptions);
    return { signedOut: true };
  });
  app.post(
    "/api/webhooks/whoop",
    {
      config: {
        rawBody: true,
        rateLimit: { max: 600, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const timestamp = req.headers["x-whoop-signature-timestamp"];
      const signature = req.headers["x-whoop-signature"];
      if (
        typeof timestamp !== "string" ||
        typeof signature !== "string" ||
        !validSignature(
          (req.rawBody as string) ?? "",
          timestamp,
          signature,
          config.ClientSecret,
        )
      )
        throw fail(401, "Invalid signature.");
      const event = z
        .object({
          user_id: z.number().int(),
          id: z.string().uuid(),
          type: z.enum([
            "sleep.updated",
            "sleep.deleted",
            "workout.updated",
            "workout.deleted",
            "recovery.updated",
            "recovery.deleted",
          ]),
          trace_id: z.string().min(1).max(200),
        })
        .parse(req.body);
      await db.transaction(async (tx) => {
        const [m] = await tx
          .select()
          .from(members)
          .where(
            and(
              eq(members.whoopId, String(event.user_id)),
              eq(members.connected, true),
            ),
          )
          .for("update");
        if (!m) return;
        const [accepted] = await tx
          .insert(webhooks)
          .values({ trace: event.trace_id, memberId: m.id })
          .onConflictDoNothing()
          .returning();
        if (accepted)
          await enqueue(
            tx,
            m.id,
            "event",
            { type: event.type, id: event.id },
            `event:${event.trace_id}`,
            1,
          );
      });
      return reply.code(204).send();
    },
  );
  if (options.serveStatic !== false && existsSync(resolve("dist/web"))) {
    await app.register(staticFiles, {
      root: resolve("dist/web"),
      wildcard: false,
      cacheControl: false,
      etag: false,
      lastModified: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (
        !["GET", "HEAD"].includes(req.method) ||
        !/^\/(?:demo|privacy|share\/[A-Za-z0-9_-]{40,100})\/?$/.test(
          req.url.split("?")[0],
        )
      )
        return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }
  return app;
}
