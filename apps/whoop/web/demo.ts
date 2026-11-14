import { completeness } from "../server/history";
import { today } from "./dates";
import { explorationHistory } from "../server/explore";
import { bucket, daily, summarize, type Detail } from "../server/domain";
import { analyticsPayload, lifetimeStats } from "../server/analytics";
import type { Dashboard } from "./types";
export function sample(start: string, end: string): Dashboard {
  const details: Detail[] = [];
  const first = "2023-01-01";
  const latest = today();
  for (
    let t = Date.parse(first), i = 0;
    t <= Date.parse(latest);
    t += 86400000, i++
  ) {
    const date = new Date(t).toISOString().slice(0, 10);
    i = Math.floor(t / 86400000);
    const noise = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const base = {
      date,
      start: date + "T07:00:00Z",
      end: date + "T08:00:00Z",
      state: "SCORED",
      nap: false,
      sport: null,
    };
    details.push({
      ...base,
      kind: "cycle",
      metrics: {
        strain: 11 + 4 * Math.sin(i * 0.72) + noise,
        average_heart_rate: 65,
        max_heart_rate: 172,
        kilojoule: 8500,
        step_count: 8200,
      },
    });
    details.push({
      ...base,
      kind: "sleep",
      metrics: {
        sleep_performance_percentage: 86 + 10 * Math.sin(i * 0.56),
        sleep_hours: 7.6 + 0.8 * Math.sin(i * 0.56),
        sleep_needed_hours: 8.2,
        sleep_debt_hours: 0.4 + 0.3 * Math.sin(i * 0.4),
        bedtime_hour: (23.5 + Math.sin(i * 0.56) + 24) % 24,
        wake_hour: 7.5 + 0.5 * Math.sin(i * 0.56),
        sleep_efficiency_percentage: 92,
        sleep_consistency_percentage: 83,
        respiratory_rate: 15.2,
        total_light_sleep_time_milli:
          (7.6 + 0.8 * Math.sin(i * 0.56)) * 0.52 * 3600000,
        total_slow_wave_sleep_time_milli:
          (7.6 + 0.8 * Math.sin(i * 0.56)) * 0.22 * 3600000,
        total_rem_sleep_time_milli:
          (7.6 + 0.8 * Math.sin(i * 0.56)) * 0.26 * 3600000,
      },
    });
    if (i % 5 === 0)
      details.push({
        ...base,
        kind: "sleep",
        nap: true,
        metrics: { sleep_hours: 0.5 },
      });
    if (i % 3 === 0)
      details.push({
        ...base,
        kind: "workout",
        sport: i % 2 ? "Running" : "Cycling",
        metrics: {
          strain: 7 + (i % 10),
          average_heart_rate: 120 + (i % 30),
          max_heart_rate: 175,
          ...Object.fromEntries(
            ["zero", "one", "two", "three", "four", "five"].map((z, j) => [
              "zone_" + z + "_milli",
              ((j + 1) / 21) * (30 + (i % 90)) * 60000,
            ]),
          ),
        },
        start: date + "T16:00:00Z",
        end: new Date(
          Date.parse(date + "T16:00:00Z") + (30 + (i % 90)) * 60000,
        ).toISOString(),
      });
    details.push({
      ...base,
      kind: "recovery",
      metrics: {
        recovery_score: Math.min(
          100,
          Math.round(66 + 25 * Math.sin(i * 0.48) + 10 * noise),
        ),
        hrv_rmssd_milli: 68 + 12 * Math.sin(i * 0.48),
        resting_heart_rate: 52 + 4 * Math.sin(i * 0.48),
        spo2_percentage: 97.2,
        skin_temp_celsius: 33.4,
      },
    });
  }
  const span = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  const previousStart = new Date(Date.parse(start) - span * 86400000)
    .toISOString()
    .slice(0, 10);
  const previousEnd = new Date(Date.parse(start) - 86400000)
    .toISOString()
    .slice(0, 10);
  const days = daily(details, previousStart, end);
  const current = days.filter((d) => d.date >= start);
  return {
    analytics: analyticsPayload(details, start, end),
    lifetime: lifetimeStats(details),
    exploration: explorationHistory(details),
    completeness: completeness(
      details,
      current.map((d) => d.date),
    ),
    name: "Alex Morgan",
    start,
    end,
    earliest: first,
    latest,
    lastSync: null,
    summary: summarize(current),
    previous: summarize(days.filter((d) => d.date < start)),
    previousStart,
    previousEnd,
    days: current,
    chart: bucket(current),
    details: details.filter((d) => d.date >= start && d.date <= end),
    body: null,
  };
}
