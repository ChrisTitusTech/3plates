import { test } from "node:test";
import assert from "node:assert/strict";
import {
  correlations,
  compareYears,
  exploreWorkouts,
} from "../server/explore.js";
import { daily, type Detail } from "../server/domain.js";

test("correlations match calendar dates, retain zero, exclude gaps and require variation", () => {
  const days = daily([], "2024-01-01", "2024-01-15").map((d, i) => ({
    ...d,
    strain: i,
    recovery: i === 0 ? null : (i - 1) * 2,
  }));
  const result = correlations(days, "strain", "recovery", 1);
  assert.equal(result.count, 14);
  assert.equal(result.r, 1);
  assert.deepEqual(result.points[0], {
    date: "2024-01-01",
    outcomeDate: "2024-01-02",
    x: 0,
    y: 0,
  });
  assert.equal(correlations(days.slice(0, 9), "strain", "recovery", 1).r, null);
  assert.equal(
    correlations(
      days.map((d) => ({ ...d, strain: 1 })),
      "strain",
      "recovery",
      1,
    ).r,
    null,
  );
  assert.equal(
    correlations(
      days.filter((d) => d.date !== "2024-01-05"),
      "strain",
      "recovery",
      1,
    ).count,
    12,
  );
});

test("year comparisons align month/day with paired coverage and handle leap days and partial years", () => {
  const days = daily([], "2023-02-28", "2024-03-02").map((d) => ({
    ...d,
    strain:
      (
        {
          "2023-02-28": 0,
          "2023-03-01": 10,
          "2023-03-02": 20,
          "2024-02-28": 8,
          "2024-02-29": 21,
          "2024-03-01": 14,
        } as Record<string, number>
      )[d.date] ?? null,
  }));
  const result = compareYears(days, 2024, 2023, "strain");
  assert.equal(result[1].a, 8);
  assert.equal(result[1].b, 0);
  assert.equal(result[1].count, 1);
  assert.equal(result[2].a, 14);
  assert.equal(result[2].b, 10);
  assert.equal(result[2].count, 1);
  assert.equal(result[0].a, null);
});

test("workout filters exclude unknown measurements only when requested and weekly hours are not strain sums", () => {
  const workout = (
    date: string,
    sport: string,
    minutes: number | null,
    strain: number | null,
  ): Detail => ({
    kind: "workout",
    date,
    sport,
    start: date + "T12:00:00Z",
    end:
      minutes === null
        ? null
        : new Date(
            Date.parse(date + "T12:00:00Z") + minutes * 60000,
          ).toISOString(),
    state: "SCORED",
    nap: false,
    metrics: { strain, zone_two_milli: 600000 },
  });
  const rows = [
    workout("2026-01-05", "Running", 30, 0),
    workout("2026-01-06", "Running", 60, 12),
    workout("2026-01-07", "Cycling", null, null),
  ];
  assert.equal(exploreWorkouts(rows, {}).rows.length, 3);
  const result = exploreWorkouts(rows, {
    sport: "Running",
    minMinutes: 45,
    minStrain: 10,
    zone: "zone_two_milli",
    minZoneMinutes: 5,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.weeks[0].hours, 1);
  assert.equal(exploreWorkouts(rows, { maxStrain: 0 }).rows.length, 1);
  assert.equal(exploreWorkouts(rows, { minMinutes: 0 }).rows.length, 2);
});
