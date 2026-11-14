import assert from "node:assert/strict";
import { test } from "node:test";
import * as analytics from "../server/analytics.js";
import { daily, type Detail } from "../server/domain.js";
const row = (
  date: string,
  kind: string,
  metrics: Detail["metrics"],
  nap = false,
): Detail => ({
  date,
  kind,
  metrics,
  nap,
  start: `${date}T00:00:00Z`,
  end: null,
  state: "SCORED",
  sport: null,
});

test("recovery baseline uses prior calendar days, excludes today, and requires seven observations", () => {
  assert.equal(typeof analytics.recoveryAnalytics, "function");
  const records = Array.from({ length: 8 }, (_, i) =>
    row(`2026-01-${String(i + 1).padStart(2, "0")}`, "recovery", {
      hrv_rmssd_milli: i === 7 ? 1000 : 50,
      resting_heart_rate: i < 6 ? 60 : null,
    }),
  );
  const result = analytics.recoveryAnalytics(
    daily(records, "2026-01-01", "2026-02-06"),
  );
  assert.equal(result[6].hrvBaseline, null);
  assert.equal(result[7].hrvBaseline, 50);
  assert.equal(result[7].hrvCount, 7);
  assert.equal(result[7].rhrBaseline, null);
  assert.equal(result.at(-1)!.hrvBaseline, null);
});

test("sleep analytics separates naps and preserves incomplete stages", () => {
  assert.equal(typeof analytics.sleepAnalytics, "function");
  const records = [
    row("2026-01-01", "sleep", {
      total_light_sleep_time_milli: 14400000,
      total_slow_wave_sleep_time_milli: 7200000,
      total_rem_sleep_time_milli: 7200000,
      sleep_hours: 8,
      sleep_needed_hours: 9,
    }),
    row("2026-01-01", "sleep", { sleep_hours: 1, sleep_needed_hours: 0 }, true),
    row("2026-01-02", "sleep", { total_light_sleep_time_milli: 0 }),
  ];
  const result = analytics.sleepAnalytics(records, "2026-01-01", "2026-01-03");
  assert.equal(result[0].hours, 8);
  assert.equal(result[0].napHours, 1);
  assert.equal(result[0].light, 4);
  assert.equal(result[0].need, 9);
  assert.equal(result[1].light, null);
  assert.equal(result[2].hours, null);
  assert.equal(result[2].napHours, null);
});

test("calendar includes leap days and keeps missing distinct from zero", () => {
  assert.equal(typeof analytics.calendarYear, "function");
  const days = daily(
    [row("2024-02-29", "cycle", { strain: 0 })],
    "2024-02-29",
    "2024-02-29",
  );
  const year = analytics.calendarYear(days, 2024);
  assert.equal(year.length, 366);
  assert.equal(year.find((d) => d.date === "2024-02-29")!.strain, 0);
  assert.equal(year.find((d) => d.date === "2024-02-28")!.strain, null);
});

test("a short selected range retains baseline context and whole-history calendar", () => {
  const records = Array.from({ length: 10 }, (_, i) =>
    row(`2026-01-${String(i + 1).padStart(2, "0")}`, "recovery", {
      hrv_rmssd_milli: 50,
      resting_heart_rate: 60,
      recovery_score: 80,
    }),
  );
  const payload = analytics.analyticsPayload(
    records,
    "2026-01-10",
    "2026-01-10",
  );
  assert.equal(payload.recovery[0].hrvBaseline, 50);
  assert.equal(payload.recovery[0].hrvCount, 9);
  assert.equal(payload.calendar.length, 10);
  assert.deepEqual(
    analytics.analyticsPayload([], "2026-01-01", "2026-01-01").calendar,
    [],
  );
});

test("long-range analytics averages available observations and keeps all-missing buckets empty", () => {
  const rows = Array.from({ length: 800 }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
    hours: i % 2 ? 8 : null,
    missing: null,
  }));
  const monthly = analytics.aggregateAnalytics(rows);
  assert.equal(monthly.mode, "month");
  assert.ok(monthly.points.every((p) => p.hours === 8 && p.missing === null));
  assert.equal(analytics.aggregateAnalytics(rows.slice(0, 200)).mode, "week");
});

test("lifetime statistics exclude gaps, retain zero, and separate nights, naps, and workouts", () => {
  assert.equal(typeof analytics.lifetimeStats, "function");
  const details = [
    row("2026-01-01", "cycle", { strain: 0 }),
    row("2026-01-03", "cycle", { strain: 20 }),
    row("2026-01-01", "recovery", { recovery_score: 80 }),
    row("2026-01-03", "recovery", { recovery_score: 40 }),
    row("2026-01-01", "sleep", {
      sleep_hours: 8,
      sleep_performance_percentage: 90,
    }),
    row("2026-01-01", "sleep", { sleep_hours: 1 }, true),
    {
      ...row("2026-01-03", "workout", {}),
      start: "2026-01-03T12:00:00Z",
      end: "2026-01-03T13:30:00Z",
    },
    row("2026-01-04", "workout", {}),
  ];
  const result = analytics.lifetimeStats(details);
  assert.equal(result.daysRecorded, 2);
  assert.equal(result.metrics.strain.average, 10);
  assert.equal(result.metrics.strain.count, 2);
  assert.deepEqual(result.metrics.strain.highest, {
    value: 20,
    date: "2026-01-03",
  });
  assert.equal(result.greenRecoveryDays, 1);
  assert.equal(result.sleepHours, 8);
  assert.equal(result.napHours, 1);
  assert.equal(result.workouts, 2);
  assert.equal(result.workoutHours, 1.5);
  assert.equal(result.timedWorkouts, 1);
  assert.equal(result.lastDate, "2026-01-04");
  const empty = analytics.lifetimeStats([]);
  assert.equal(empty.firstDate, null);
  assert.equal(empty.metrics.strain.average, null);
  assert.equal(empty.metrics.strain.highest, null);
  assert.equal(empty.sleepHours, null);
});
