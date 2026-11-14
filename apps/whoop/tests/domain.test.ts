import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import {
  bucket,
  daily,
  detail,
  localDate,
  makeDetails,
  normalize,
  summarize,
} from "../server/domain.js";
import {
  csvCell,
  redactedPath,
  decrypt,
  encrypt,
  validSignature,
} from "../server/security.js";

test("recorded offsets preserve local dates across travel and UTC boundaries", () => {
  assert.equal(localDate("2026-03-09T02:00:00Z", "-05:00"), "2026-03-08");
  assert.equal(localDate("2026-03-09T20:30:00Z", "+05:30"), "2026-03-10");
});
test("cycle relationships align recovery and sleep; naps do not inflate sleep performance", () => {
  const records = [
    normalize("cycle", {
      id: 42,
      start: "2026-01-02T08:00:00Z",
      timezone_offset: "-06:00",
      score_state: "SCORED",
      score: { strain: 12 },
    }),
    normalize("sleep", {
      id: "sleep",
      cycle_id: 42,
      start: "2026-01-01T22:00:00Z",
      end: "2026-01-02T06:00:00Z",
      score_state: "SCORED",
      score: {
        sleep_performance_percentage: 90,
        stage_summary: {
          total_light_sleep_time_milli: 14400000,
          total_slow_wave_sleep_time_milli: 7200000,
          total_rem_sleep_time_milli: 3600000,
        },
      },
    }),
    normalize("sleep", {
      id: "nap",
      cycle_id: 42,
      start: "2026-01-02T14:00:00Z",
      end: "2026-01-02T15:00:00Z",
      nap: true,
      score_state: "SCORED",
      score: { sleep_performance_percentage: 20 },
    }),
    normalize("recovery", {
      cycle_id: 42,
      sleep_id: "sleep",
      created_at: "2026-01-03T00:00:00Z",
      score_state: "SCORED",
      score: { recovery_score: 80 },
    }),
  ];
  const details = makeDetails(records);
  const days = daily(details, "2026-01-02", "2026-01-03");
  assert.equal(days[0].sleep, 90);
  assert.equal(days[0].hours, 7);
  assert.equal(days[0].recovery, 80);
  assert.equal(days[1].recovery, null);
});
test("unscored and absent metrics are gaps, while zero is a valid score", () => {
  const pending = detail(
    normalize("cycle", {
      id: 1,
      start: "2026-01-01T12:00:00Z",
      score_state: "PENDING_SCORE",
      score: { strain: 20 },
    }),
  );
  const zero = detail(
    normalize("cycle", {
      id: 2,
      start: "2026-01-02T12:00:00Z",
      score_state: "SCORED",
      score: { strain: 0 },
    }),
  );
  const days = daily([pending, zero], "2026-01-01", "2026-01-03");
  assert.deepEqual(
    days.map((d) => d.strain),
    [null, 0, null],
  );
  assert.deepEqual(summarize(days).strain, { value: 0, count: 1 });
});
test("long-range buckets average strain rather than adding it", () => {
  const records = Array.from({ length: 150 }, (_, i) =>
    detail(
      normalize("cycle", {
        id: i,
        start: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
        score_state: "SCORED",
        score: { strain: 10 },
      }),
    ),
  );
  const result = bucket(daily(records, "2025-01-01", "2025-05-30"));
  assert.equal(result.mode, "week");
  assert.ok(result.points.every((p) => p.strain === 10));
});
test("public detail projection excludes arbitrary raw fields and identity data", () => {
  const d = detail(
    normalize("cycle", {
      id: 1,
      user_id: 123,
      email: "private@example.test",
      injected: "secret",
      start: "2026-01-01T00:00:00Z",
      score_state: "SCORED",
      score: { strain: 12, private_token: "secret" },
    }),
  );
  assert.ok(!JSON.stringify(d).includes("secret"));
  assert.ok(!JSON.stringify(d).includes("user_id"));
  assert.equal(d.metrics.strain, 12);
});
test("token encryption is randomized, authenticated, and rejects tampering", () => {
  const key = "a".repeat(64);
  const first = encrypt({ token: "private" }, key);
  const second = encrypt({ token: "private" }, key);
  assert.notEqual(first, second);
  assert.deepEqual(decrypt(first, key), { token: "private" });
  assert.throws(() => decrypt(first, "b".repeat(64)));
});
test("webhooks require the exact raw body, correct secret, and a fresh timestamp", () => {
  const raw = '{"event":"sleep.updated"}';
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", "test-secret")
    .update(timestamp + raw)
    .digest("base64");
  assert.ok(validSignature(raw, timestamp, signature, "test-secret"));
  assert.ok(!validSignature(raw + " ", timestamp, signature, "test-secret"));
  assert.ok(
    !validSignature(
      raw,
      timestamp,
      signature,
      "test-secret",
      Date.now() + 360000,
    ),
  );
  assert.ok(!validSignature(raw, timestamp, "short", "test-secret"));
});
test("CSV output escapes formulas, quotes, and embedded newlines", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
});

test("sleep need uses the signed nap adjustment and preserves missing components", () => {
  const make = (need: Record<string, number>) =>
    detail(
      normalize("sleep", {
        id: "night",
        start: "2026-01-01T05:30:00Z",
        end: "2026-01-01T13:30:00Z",
        timezone_offset: "-06:00",
        score_state: "SCORED",
        score: { sleep_needed: need },
      }),
    );
  const night = make({
    baseline_milli: 28800000,
    need_from_sleep_debt_milli: 3600000,
    need_from_recent_strain_milli: 0,
    need_from_recent_nap_milli: -1800000,
  });
  assert.equal(night.metrics.sleep_needed_hours, 8.5);
  assert.equal(night.metrics.sleep_debt_hours, 1);
  assert.equal(night.metrics.bedtime_hour, 23.5);
  assert.equal(night.metrics.wake_hour, 7.5);
  assert.equal(
    make({ baseline_milli: 28800000 }).metrics.sleep_needed_hours,
    null,
  );
});

test("a pre-midnight main sleep anchors its cycle, recovery, and workouts to the local wake date", () => {
  const records = [
    normalize("cycle", {
      id: 1,
      start: "2026-02-10T07:00:00Z",
      end: "2026-02-11T04:30:00Z",
      timezone_offset: "-05:00",
      score_state: "SCORED",
      score: { strain: 5 },
    }),
    normalize("cycle", {
      id: 2,
      start: "2026-02-11T04:30:00Z",
      end: "2026-02-12T06:00:00Z",
      timezone_offset: "-05:00",
      score_state: "SCORED",
      score: { strain: 15 },
    }),
    normalize("sleep", {
      id: "night",
      cycle_id: 2,
      start: "2026-02-11T04:30:00Z",
      end: "2026-02-11T13:00:00Z",
      timezone_offset: "-05:00",
      score_state: "SCORED",
      score: { sleep_performance_percentage: 90 },
    }),
    normalize("sleep", {
      id: "nap",
      cycle_id: 2,
      start: "2026-02-12T04:00:00Z",
      end: "2026-02-12T05:30:00Z",
      timezone_offset: "-05:00",
      nap: true,
    }),
    normalize("recovery", {
      cycle_id: 2,
      sleep_id: "night",
      created_at: "2026-02-11T14:00:00Z",
      score_state: "SCORED",
      score: { recovery_score: 80 },
    }),
    normalize("workout", {
      id: "training",
      start: "2026-02-11T20:00:00Z",
      end: "2026-02-11T21:00:00Z",
      timezone_offset: "-05:00",
    }),
  ];
  const details = makeDetails(records);
  const days = daily(details, "2026-02-10", "2026-02-11");
  assert.deepEqual(
    days.map((d) => d.strain),
    [5, 15],
  );
  assert.equal(days[1].sleep, 90);
  assert.equal(days[1].recovery, 80);
  assert.ok(details.slice(1).every((d) => d.date === "2026-02-11"));
  assert.deepEqual(
    makeDetails(records.slice().reverse())
      .map((d) => d.date)
      .reverse(),
    details.map((d) => d.date),
  );
});

test("recovery links anchor sleeps without cycle IDs, while absent main sleep keeps the cycle fallback", () => {
  const records = [
    normalize("cycle", {
      id: 3,
      start: "2026-03-01T18:00:00Z",
      timezone_offset: "+05:30",
    }),
    normalize("sleep", {
      id: "linked",
      start: "2026-03-01T18:00:00Z",
      end: "2026-03-02T02:00:00Z",
      timezone_offset: "+05:30",
    }),
    normalize("recovery", {
      cycle_id: 3,
      sleep_id: "linked",
      created_at: "2026-03-03T00:00:00Z",
    }),
  ];
  assert.ok(makeDetails(records).every((d) => d.date === "2026-03-02"));
  assert.equal(makeDetails(records.slice(0, 1))[0].date, "2026-03-01");
});

test("request log paths redact share tokens and query credentials", () => {
  assert.equal(
    redactedPath("/share/secret-token?code=secret"),
    "/share/[redacted]",
  );
  assert.equal(
    redactedPath("/api/shared/secret-token?start=2026-01-01"),
    "/api/shared/[redacted]",
  );
  assert.equal(
    redactedPath("/callback?code=secret&state=private"),
    "/callback",
  );
});
