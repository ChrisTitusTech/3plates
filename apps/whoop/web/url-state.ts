import { useEffect, useState } from "react";
const choices: Record<string, unknown[]> = {
  tab: [
    "overview",
    "strain",
    "sleep",
    "recovery",
    "workouts",
    "correlations",
    "years",
  ],
  range: ["7", "30", "90", "365", "all", "custom"],
  workoutSort: ["newest", "duration", "strain"],
  input: ["hours", "sleep", "strain"],
  outcome: ["recovery", "hrv", "rhr", "hours"],
  lag: [0, 1],
  yearMetric: ["strain", "sleep", "recovery", "hours", "hrv", "rhr"],
};
function valid(key: string, value: unknown) {
  if (choices[key]) return choices[key].includes(value);
  if (key === "start" || key === "end")
    return (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
    );
  if (key === "firstYear" || key === "secondYear")
    return (
      value === null ||
      (typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 1900 &&
        value <= 2200)
    );
  if (key === "workoutFilters")
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.entries(value).every(
        ([k, v]) =>
          (k === "sport" && typeof v === "string" && v.length <= 100) ||
          (k === "zone" &&
            typeof v === "string" &&
            /^zone_(zero|one|two|three|four|five)_milli$/.test(v)) ||
          ([
            "minMinutes",
            "maxMinutes",
            "minStrain",
            "maxStrain",
            "minZoneMinutes",
          ].includes(k) &&
            typeof v === "number" &&
            Number.isFinite(v) &&
            v >= 0),
      )
    );
  return false;
}
let queued: URL | null = null;
function persist(url: URL) {
  const scheduled = queued !== null;
  queued = url;
  if (!scheduled)
    queueMicrotask(() => {
      if (queued && queued.href !== location.href)
        history.pushState(null, "", queued);
      queued = null;
    });
}
export function useUrlState<T>(key: string, fallback: T) {
  const read = () => {
    const raw = new URL(location.href).searchParams.get(key);
    try {
      const parsed = raw === null ? fallback : JSON.parse(raw);
      return valid(key, parsed) ? (parsed as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const changed = () => setValue(read());
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  const update = (next: T | ((old: T) => T)) => {
    const result =
      typeof next === "function" ? (next as (old: T) => T)(value) : next;
    const url = new URL(queued ?? location.href);
    url.searchParams.set(key, JSON.stringify(result));
    persist(url);
    setValue(result);
  };
  return [value, update] as const;
}
