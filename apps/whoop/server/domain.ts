export const historyKinds = ["cycle", "sleep", "recovery", "workout"] as const;
export type HistoryKind = (typeof historyKinds)[number];
export const endpoints: Record<string, string> = {
  cycle: "/cycle",
  sleep: "/activity/sleep",
  recovery: "/recovery",
  workout: "/activity/workout",
  profile: "/user/profile/basic",
  body: "/user/measurement/body",
};
export type Raw = Record<string, any>;
export type StoredRecord = {
  kind: string;
  sourceId: string;
  cycleId: string | null;
  start: Date;
  end: Date | null;
  localDate: string;
  raw: Raw;
};
export type Detail = {
  kind: string;
  date: string;
  start: string;
  end: string | null;
  state: string;
  nap: boolean;
  sport: string | null;
  metrics: Record<string, number | null>;
};
export type Day = {
  date: string;
  strain: number | null;
  sleep: number | null;
  hours: number | null;
  recovery: number | null;
  hrv: number | null;
  rhr: number | null;
  strainAverage: number | null;
};
export const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
export const average = (values: (number | null)[]) => {
  const v = values.filter((n): n is number => n !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
export function localDate(iso: string, offset = "Z") {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  const minutes = match
    ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "-" ? -1 : 1)
    : 0;
  return new Date(new Date(iso).getTime() + minutes * 60000)
    .toISOString()
    .slice(0, 10);
}
export function normalize(kind: string, raw: Raw, now = new Date()) {
  const sourceId =
    kind === "recovery"
      ? String(raw.cycle_id)
      : kind === "body"
        ? now.toISOString().slice(0, 10)
        : kind === "profile"
          ? "profile"
          : String(raw.id);
  if (sourceId === "undefined")
    throw new Error("WHOOP record has no identifier");
  const start = new Date(raw.start ?? raw.created_at ?? now);
  if (!Number.isFinite(start.getTime()))
    throw new Error("WHOOP record has invalid timestamp");
  return {
    kind,
    sourceId,
    cycleId:
      kind === "cycle"
        ? sourceId
        : raw.cycle_id == null
          ? null
          : String(raw.cycle_id),
    sleepId: raw.sleep_id ?? (kind === "sleep" ? sourceId : null),
    start,
    end: raw.end ? new Date(raw.end) : null,
    localDate: localDate(
      kind === "sleep" ? (raw.end ?? start.toISOString()) : start.toISOString(),
      raw.timezone_offset,
    ),
    raw,
  };
}
export function detail(record: StoredRecord, date = record.localDate): Detail {
  const r = record.raw;
  const s = r.score_state === "SCORED" ? (r.score ?? {}) : {};
  const metrics: Record<string, number | null> = {};
  const add = (fields: string[], source: Raw = s) =>
    fields.forEach((k) => {
      metrics[k] = finite(source[k]);
    });
  if (record.kind === "cycle" || record.kind === "workout") {
    add(["strain", "average_heart_rate", "max_heart_rate", "kilojoule"]);
    if (record.kind === "cycle") add(["step_count"], r);
    else {
      add([
        "percent_recorded",
        "distance_meter",
        "altitude_gain_meter",
        "altitude_change_meter",
      ]);
      add(
        [
          "zone_zero_milli",
          "zone_one_milli",
          "zone_two_milli",
          "zone_three_milli",
          "zone_four_milli",
          "zone_five_milli",
        ],
        s.zone_durations ?? {},
      );
    }
  }
  if (record.kind === "sleep") {
    add([
      "sleep_performance_percentage",
      "sleep_consistency_percentage",
      "sleep_efficiency_percentage",
      "respiratory_rate",
    ]);
    add(
      [
        "total_in_bed_time_milli",
        "total_awake_time_milli",
        "total_no_data_time_milli",
        "total_light_sleep_time_milli",
        "total_slow_wave_sleep_time_milli",
        "total_rem_sleep_time_milli",
        "disturbance_count",
        "sleep_cycle_count",
      ],
      s.stage_summary ?? {},
    );
    const stages = [
      "total_light_sleep_time_milli",
      "total_slow_wave_sleep_time_milli",
      "total_rem_sleep_time_milli",
    ].map((k) => metrics[k]);
    metrics.sleep_hours = stages.every((n) => n !== null)
      ? stages.reduce((a, b) => a! + b!, 0)! / 3600000
      : null;
    const need = s.sleep_needed ?? {};
    const parts = [
      "baseline_milli",
      "need_from_sleep_debt_milli",
      "need_from_recent_strain_milli",
      "need_from_recent_nap_milli",
    ].map((k) => finite(need[k]));
    metrics.sleep_needed_hours = parts.every((n) => n !== null)
      ? parts.reduce<number>((sum, n) => sum + n!, 0) / 3600000
      : null;
    metrics.sleep_debt_hours =
      finite(need.need_from_sleep_debt_milli) === null
        ? null
        : need.need_from_sleep_debt_milli / 3600000;
    const offset = /^([+-])(\d{2}):(\d{2})$/.exec(r.timezone_offset ?? "");
    const minutes = offset
      ? (Number(offset[2]) * 60 + Number(offset[3])) *
        (offset[1] === "-" ? -1 : 1)
      : null;
    for (const [key, time] of [
      ["bedtime_hour", record.start],
      ["wake_hour", record.end],
    ] as const) {
      const date =
        time && minutes !== null
          ? new Date(time.getTime() + minutes * 60000)
          : null;
      metrics[key] = date
        ? date.getUTCHours() + date.getUTCMinutes() / 60
        : null;
    }
  }
  if (record.kind === "recovery")
    add([
      "recovery_score",
      "resting_heart_rate",
      "hrv_rmssd_milli",
      "spo2_percentage",
      "skin_temp_celsius",
    ]);
  if (record.kind === "body")
    add(["height_meter", "weight_kilogram", "max_heart_rate"], r);
  return {
    kind: record.kind,
    date,
    start: record.start.toISOString(),
    end: record.end?.toISOString() ?? null,
    state: String(r.score_state ?? "AVAILABLE"),
    nap: r.nap === true,
    sport:
      record.kind === "workout"
        ? typeof r.sport_name === "string"
          ? r.sport_name.slice(0, 100)
          : `Activity ${r.sport_id ?? ""}`
        : null,
    metrics,
  };
}
export function makeDetails(records: StoredRecord[]) {
  const sleepRecords = records.filter((r) => r.kind === "sleep");
  const sleepById = new Map(sleepRecords.map((r) => [r.sourceId, r]));
  const mainSleepByCycle = new Map<string, StoredRecord>();
  const sleepCycle = new Map<string, string>();
  // Choose deterministically; a nap or unfinished sleep cannot move the day.
  for (const sleep of sleepRecords
    .slice()
    .sort(
      (a, b) =>
        (a.end?.getTime() ?? Infinity) - (b.end?.getTime() ?? Infinity) ||
        a.sourceId.localeCompare(b.sourceId),
    )) {
    if (sleep.cycleId) {
      sleepCycle.set(sleep.sourceId, sleep.cycleId);
      if (!sleep.raw.nap && sleep.end && !mainSleepByCycle.has(sleep.cycleId))
        mainSleepByCycle.set(sleep.cycleId, sleep);
    }
  }
  // The recovery relationship also supports sleep payloads without cycle_id.
  for (const recovery of records.filter((r) => r.kind === "recovery")) {
    const sleep = sleepById.get(String(recovery.raw.sleep_id));
    if (sleep && recovery.cycleId && !sleep.raw.nap && sleep.end) {
      sleepCycle.set(sleep.sourceId, recovery.cycleId);
      mainSleepByCycle.set(recovery.cycleId, sleep);
    }
  }
  const cycles = new Map(
    records
      .filter((r) => r.kind === "cycle")
      .map((r) => {
        const sleep = mainSleepByCycle.get(r.sourceId);
        return [
          r.sourceId,
          sleep?.end
            ? localDate(
                sleep.end.toISOString(),
                sleep.raw.timezone_offset ?? r.raw.timezone_offset,
              )
            : r.localDate,
        ];
      }),
  );
  const sleeps = new Map(
    sleepRecords.map((r) => [
      r.sourceId,
      cycles.get(sleepCycle.get(r.sourceId) ?? "") ?? r.localDate,
    ]),
  );
  const ordered = records
    .filter((r) => r.kind === "cycle")
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const workoutDate = (r: StoredRecord) => {
    if (r.kind !== "workout") return undefined;
    let lo = 0;
    let hi = ordered.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (ordered[mid].start <= r.start) lo = mid + 1;
      else hi = mid;
    }
    const cycle = ordered[lo - 1];
    return cycle && (!cycle.end || r.start < cycle.end)
      ? cycles.get(cycle.sourceId)
      : undefined;
  };
  return records
    .filter((r) => r.kind !== "profile")
    .map((r) =>
      detail(
        r,
        cycles.get(r.kind === "cycle" ? r.sourceId : (r.cycleId ?? "")) ??
          sleeps.get(
            r.kind === "sleep" ? r.sourceId : String(r.raw.sleep_id),
          ) ??
          workoutDate(r) ??
          r.localDate,
      ),
    );
}
export function daily(details: Detail[], start: string, end: string): Day[] {
  const grouped = new Map<string, Detail[]>();
  for (const d of details) {
    const list = grouped.get(d.date) ?? [];
    list.push(d);
    grouped.set(d.date, list);
  }
  const days: Day[] = [];
  for (let ts = Date.parse(start); ts <= Date.parse(end); ts += 86400000) {
    const date = new Date(ts).toISOString().slice(0, 10);
    const rs = grouped.get(date) ?? [];
    const mean = (kind: string, key: string) =>
      average(
        rs
          .filter((r) => r.kind === kind && !r.nap)
          .map((r) => r.metrics[key] ?? null),
      );
    days.push({
      date,
      strain: mean("cycle", "strain"),
      sleep: mean("sleep", "sleep_performance_percentage"),
      hours: mean("sleep", "sleep_hours"),
      recovery: mean("recovery", "recovery_score"),
      hrv: mean("recovery", "hrv_rmssd_milli"),
      rhr: mean("recovery", "resting_heart_rate"),
      strainAverage: null,
    });
  }
  return days.map((d, i) => ({
    ...d,
    strainAverage: average(
      days.slice(Math.max(0, i - 6), i + 1).map((x) => x.strain),
    ),
  }));
}
export function summarize(days: Day[]) {
  return Object.fromEntries(
    ["strain", "sleep", "hours", "recovery", "hrv", "rhr"].map((key) => {
      const values = days.map((d) => d[key as keyof Day] as number | null);
      return [
        key,
        {
          value: average(values),
          count: values.filter((n) => n !== null).length,
        },
      ];
    }),
  );
}
export function bucket(days: Day[]): {
  mode: string;
  points: (Day & { endDate: string })[];
} {
  const mode = days.length > 730 ? "month" : days.length > 120 ? "week" : "day";
  const groups = new Map<string, Day[]>();
  for (const day of days) {
    const date = new Date(day.date);
    if (mode === "week")
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const key =
      mode === "month"
        ? day.date.slice(0, 7) + "-01"
        : mode === "week"
          ? date.toISOString().slice(0, 10)
          : day.date;
    const group = groups.get(key) ?? [];
    group.push(day);
    groups.set(key, group);
  }
  return {
    mode,
    points: [...groups].map(
      ([date, rows]) =>
        ({
          date,
          endDate: rows.at(-1)!.date,
          ...Object.fromEntries(
            [
              "strain",
              "sleep",
              "hours",
              "recovery",
              "hrv",
              "rhr",
              "strainAverage",
            ].map((k) => [
              k,
              average(rows.map((r) => r[k as keyof Day] as number | null)),
            ]),
          ),
        }) as Day & { endDate: string },
    ),
  };
}
