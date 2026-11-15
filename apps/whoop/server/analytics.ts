import { average, daily, type Day, type Detail } from "./domain.js";

export type CalendarDay = Pick<Day, "date" | "strain" | "sleep" | "recovery">;
export function calendarYear(days: CalendarDay[], year: number): CalendarDay[] {
  const lookup = new Map(days.map((d) => [d.date, d]));
  const result: CalendarDay[] = [];
  for (
    let t = Date.UTC(year, 0, 1);
    t < Date.UTC(year + 1, 0, 1);
    t += 86400000
  ) {
    const date = new Date(t).toISOString().slice(0, 10);
    result.push(
      lookup.get(date) ?? { date, strain: null, sleep: null, recovery: null },
    );
  }
  return result;
}

export function recoveryAnalytics(days: Day[]) {
  return days.map((day, index) => {
    const preceding = days
      .slice(Math.max(0, index - 28), index)
      .filter(
        (d) => Date.parse(d.date) >= Date.parse(day.date) - 28 * 86400000,
      );
    const hrv = preceding.map((d) => d.hrv).filter((n) => n !== null);
    const rhr = preceding.map((d) => d.rhr).filter((n) => n !== null);
    return {
      date: day.date,
      hrv: day.hrv,
      rhr: day.rhr,
      hrvBaseline: hrv.length >= 7 ? average(hrv) : null,
      rhrBaseline: rhr.length >= 7 ? average(rhr) : null,
      hrvCount: hrv.length,
      rhrCount: rhr.length,
    };
  });
}

export function sleepAnalytics(details: Detail[], start: string, end: string) {
  const grouped = new Map<string, Detail[]>();
  for (const d of details.filter(
    (d) => d.kind === "sleep" && d.state === "SCORED",
  )) {
    const rows = grouped.get(d.date) ?? [];
    rows.push(d);
    grouped.set(d.date, rows);
  }
  return daily([], start, end).map((day) => {
    const rows = grouped.get(day.date) ?? [];
    const main = rows.filter((d) => !d.nap);
    const mean = (key: string) =>
      average(main.map((d) => d.metrics[key] ?? null));
    const stages = [
      "total_light_sleep_time_milli",
      "total_slow_wave_sleep_time_milli",
      "total_rem_sleep_time_milli",
    ];
    // Use the same complete nights for every stacked segment.
    const complete = main.filter((d) =>
      stages.every((k) => d.metrics[k] != null),
    );
    const stage = (key: string) => {
      const value = average(complete.map((d) => d.metrics[key]));
      return value === null ? null : value / 3600000;
    };
    const naps = rows.filter((d) => d.nap);
    const napValues = naps.map((d) => d.metrics.sleep_hours ?? null);
    return {
      date: day.date,
      hours: mean("sleep_hours"),
      need: mean("sleep_needed_hours"),
      debt: mean("sleep_debt_hours"),
      light: stage(stages[0]),
      deep: stage(stages[1]),
      rem: stage(stages[2]),
      efficiency: mean("sleep_efficiency_percentage"),
      consistency: mean("sleep_consistency_percentage"),
      bedtime: average(
        main.map((d) => {
          const h = d.metrics.bedtime_hour;
          return h == null ? null : h < 12 ? h + 24 : h;
        }),
      ),
      wake: mean("wake_hour"),
      napHours:
        napValues.length && napValues.every((n) => n !== null)
          ? napValues.reduce<number>((s, n) => s + n!, 0)
          : null,
    };
  });
}

export function analyticsPayload(
  details: Detail[],
  start: string,
  end: string,
) {
  const contextStart = new Date(Date.parse(start) - 28 * 86400000)
    .toISOString()
    .slice(0, 10);
  const dates = details
    .filter((d) => ["cycle", "sleep", "recovery"].includes(d.kind))
    .map((d) => d.date)
    .sort();
  return {
    sleep: sleepAnalytics(details, start, end),
    recovery: recoveryAnalytics(daily(details, contextStart, end)).filter(
      (d) => d.date >= start,
    ),
    calendar: dates.length
      ? daily(details, dates[0], dates.at(-1)!)
          .filter(
            (d) => d.strain !== null || d.sleep !== null || d.recovery !== null,
          )
          .map(({ date, strain, sleep, recovery }) => ({
            date,
            strain,
            sleep,
            recovery,
          }))
      : [],
  };
}

// Same calendar boundaries as the overview charts; averages never fill missing days.
export function aggregateAnalytics<T extends { date: string }>(
  rows: T[],
): { mode: string; points: Record<string, string | number | null>[] } {
  const mode = rows.length > 730 ? "month" : rows.length > 120 ? "week" : "day";
  if (mode === "day")
    return {
      mode,
      points: rows as unknown as Record<string, string | number | null>[],
    };
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const date = new Date(row.date);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const key =
      mode === "month"
        ? row.date.slice(0, 7) + "-01"
        : date.toISOString().slice(0, 10);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return {
    mode,
    points: [...groups].map(([date, group]) => ({
      date,
      ...Object.fromEntries(
        Object.keys(group[0])
          .filter((k) => k !== "date")
          .map((key) => [
            key,
            average(group.map((r) => (r as Record<string, any>)[key] ?? null)),
          ]),
      ),
    })),
  };
}

export function lifetimeStats(details: Detail[]) {
  const history = details.filter((d) =>
    ["cycle", "sleep", "recovery", "workout"].includes(d.kind),
  );
  const dates = history.map((d) => d.date).sort();
  const firstDate = dates[0] ?? null;
  const lastDate = dates.at(-1) ?? null;
  const days = firstDate && lastDate ? daily(history, firstDate, lastDate) : [];
  const keys = ["strain", "sleep", "recovery", "hours", "hrv", "rhr"] as const;
  const metrics = Object.fromEntries(
    keys.map((key) => {
      const scored = days.filter((d) => d[key] !== null);
      const extreme = (highest: boolean) => {
        const best = scored.reduce<Day | null>(
          (a, b) =>
            !a || (highest ? b[key]! > a[key]! : b[key]! < a[key]!) ? b : a,
          null,
        );
        return best ? { value: best[key]!, date: best.date } : null;
      };
      return [
        key,
        {
          average: average(scored.map((d) => d[key])),
          count: scored.length,
          highest: extreme(true),
          lowest: extreme(false),
        },
      ];
    }),
  );
  const sum = (values: (number | null)[]) => {
    const available = values.filter(
      (v): v is number => v !== null && Number.isFinite(v),
    );
    return available.length ? available.reduce((a, b) => a + b, 0) : null;
  };
  const sleeps = history.filter(
    (d) => d.kind === "sleep" && d.state === "SCORED",
  );
  const nights = sleeps.filter((d) => !d.nap);
  const workouts = history.filter((d) => d.kind === "workout");
  const durations = workouts.map((d) => {
    const hours = d.end
      ? (Date.parse(d.end) - Date.parse(d.start)) / 3600000
      : NaN;
    return Number.isFinite(hours) && hours >= 0 ? hours : null;
  });
  return {
    firstDate,
    lastDate,
    daysRecorded: days.filter(
      (d) => d.strain !== null || d.sleep !== null || d.recovery !== null,
    ).length,
    metrics,
    greenRecoveryDays: days.filter(
      (d) => d.recovery !== null && d.recovery >= 67,
    ).length,
    sleepHours: sum(nights.map((d) => d.metrics.sleep_hours ?? null)),
    nights: nights.filter((d) => d.metrics.sleep_hours != null).length,
    napHours: sum(
      sleeps.filter((d) => d.nap).map((d) => d.metrics.sleep_hours ?? null),
    ),
    workouts: workouts.length,
    workoutHours: sum(durations),
    timedWorkouts: durations.filter((d) => d !== null).length,
  };
}
