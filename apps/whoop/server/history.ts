import { analyticsPayload, lifetimeStats } from "./analytics.js";
import { makeDetails, type StoredRecord, type Detail } from "./domain.js";
import { explorationHistory } from "./explore.js";
export type SharePolicy = {
  kinds: string[];
  start?: string;
  end?: string;
  expires?: string;
};
export function restrictDetails(
  details: Detail[],
  policy?: SharePolicy | null,
) {
  return policy
    ? details.filter(
        (d) =>
          policy.kinds.includes(d.kind) &&
          (!policy.start || d.date >= policy.start) &&
          (!policy.end || d.date <= policy.end),
      )
    : details;
}
export function historyContext(details: Detail[]) {
  const history = details.filter((d) => !["body", "profile"].includes(d.kind));
  const dates = history.map((d) => d.date).sort();
  return {
    details,
    history,
    earliest: dates[0] ?? null,
    latest: dates.at(-1) ?? null,
    lifetime: lifetimeStats(history),
    exploration: explorationHistory(history),
    calendar: analyticsPayload(history, "2000-01-01", "2000-01-01").calendar,
  };
}
export function createHistoryCache() {
  const cache = new Map<
    string,
    { revision: number; at: number; value: ReturnType<typeof historyContext> }
  >();
  return async (
    key: string,
    revision: number,
    loader: () => Promise<StoredRecord[]>,
    policy?: SharePolicy | null,
  ) => {
    const old = cache.get(key);
    if (old && old.revision === revision && Date.now() - old.at < 300000)
      return old.value;
    const value = historyContext(
      restrictDetails(makeDetails(await loader()), policy),
    );
    cache.delete(key);
    // Bound retained health data and memory; no disk or shared HTTP cache.
    const size = () =>
      [...cache.values()].reduce((n, c) => n + c.value.details.length, 0);
    while (cache.size >= 20 || size() + value.details.length > 50000) {
      const first = cache.keys().next().value;
      if (first === undefined) break;
      cache.delete(first);
    }
    if (value.details.length <= 50000)
      cache.set(key, { revision, at: Date.now(), value });
    return value;
  };
}
export function completeness(details: Detail[], dates: string[]) {
  const grouped = new Map<string, Detail[]>();
  for (const d of details) {
    const key = d.date + ":" + d.kind;
    const rows = grouped.get(key) ?? [];
    rows.push(d);
    grouped.set(key, rows);
  }

  return dates.map((date) => {
    const status = (kind: string) => {
      const rows = (grouped.get(date + ":" + kind) ?? []).filter((d) => !d.nap);
      return rows.some((d) => d.state === "SCORED")
        ? "scored"
        : rows.some((d) => d.state === "PENDING_SCORE")
          ? "pending"
          : rows.length
            ? "unscored"
            : "missing";
    };
    return {
      date,
      cycle: status("cycle"),
      sleep: status("sleep"),
      recovery: status("recovery"),
    };
  });
}
