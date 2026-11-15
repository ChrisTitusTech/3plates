import { average, daily, type Day, type Detail } from "./domain.js";
export type Metric = "strain" | "sleep" | "recovery" | "hours" | "hrv" | "rhr";
const valid = (n: number | null | undefined): n is number =>
  n != null && Number.isFinite(n);

export function explorationHistory(details: Detail[]) {
  const dates = details
    .filter((d) => ["cycle", "sleep", "recovery"].includes(d.kind))
    .map((d) => d.date)
    .sort();
  return dates.length
    ? daily(details, dates[0], dates.at(-1)!).filter((d) =>
        [d.strain, d.sleep, d.recovery, d.hours, d.hrv, d.rhr].some(valid),
      )
    : [];
}

export function correlations(days: Day[], x: Metric, y: Metric, lag: 0 | 1) {
  const lookup = new Map(days.map((d) => [d.date, d]));
  const points = days.flatMap((d) => {
    const outcomeDate = new Date(Date.parse(d.date) + lag * 86400000)
      .toISOString()
      .slice(0, 10);
    const outcome = lookup.get(outcomeDate)?.[y];
    return valid(d[x]) && valid(outcome)
      ? [{ date: d.date, outcomeDate, x: d[x], y: outcome }]
      : [];
  });
  const count = points.length;
  let r: number | null = null;
  if (count >= 10) {
    const mx = average(points.map((p) => p.x))!,
      my = average(points.map((p) => p.y))!;
    const xx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    const yy = points.reduce((s, p) => s + (p.y - my) ** 2, 0);
    if (xx > 0 && yy > 0)
      r = Math.max(
        -1,
        Math.min(
          1,
          points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) /
            Math.sqrt(xx * yy),
        ),
      );
  }
  return { points, count, r };
}

export function compareYears(
  days: Day[],
  a: number,
  b: number,
  metric: Metric,
) {
  const lookup = new Map(days.map((d) => [d.date, d[metric]]));
  return Array.from({ length: 12 }, (_, i) => {
    const month = String(i + 1).padStart(2, "0");
    const pairs = days.filter(
      (d) =>
        d.date.startsWith(a + "-" + month) &&
        valid(d[metric]) &&
        valid(lookup.get(b + d.date.slice(4))),
    );
    return {
      month,
      a: average(pairs.map((d) => d[metric])),
      b: average(pairs.map((d) => lookup.get(b + d.date.slice(4))!)),
      count: pairs.length,
    };
  });
}

export type WorkoutFilters = {
  sport?: string;
  minMinutes?: number;
  maxMinutes?: number;
  minStrain?: number;
  maxStrain?: number;
  zone?: string;
  minZoneMinutes?: number;
};
export function exploreWorkouts(details: Detail[], filters: WorkoutFilters) {
  const within = (
    value: number | null | undefined,
    min?: number,
    max?: number,
  ) =>
    (min === undefined && max === undefined) ||
    (valid(value) &&
      (min === undefined || value >= min) &&
      (max === undefined || value <= max));
  const rows = details
    .filter((d) => d.kind === "workout")
    .map((d) => {
      const duration = d.end
        ? (Date.parse(d.end) - Date.parse(d.start)) / 60000
        : NaN;
      return {
        ...d,
        minutes: Number.isFinite(duration) && duration >= 0 ? duration : null,
      };
    })
    .filter(
      (d) =>
        (!filters.sport || d.sport === filters.sport) &&
        within(d.minutes, filters.minMinutes, filters.maxMinutes) &&
        within(d.metrics.strain, filters.minStrain, filters.maxStrain) &&
        (!filters.zone ||
          within(
            d.metrics[filters.zone] == null
              ? null
              : d.metrics[filters.zone]! / 60000,
            filters.minZoneMinutes,
          )),
    );
  const weeks = new Map<
    string,
    { hours: number | null; count: number; timed: number }
  >();
  for (const row of rows) {
    const date = new Date(row.date);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const key = date.toISOString().slice(0, 10);
    const week = weeks.get(key) ?? { hours: null, count: 0, timed: 0 };
    week.count++;
    if (row.minutes !== null) {
      week.hours = (week.hours ?? 0) + row.minutes / 60;
      week.timed++;
    }
    weeks.set(key, week);
  }
  return {
    rows,
    weeks: [...weeks]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v })),
  };
}
