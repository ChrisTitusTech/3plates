import { useUrlState } from "./url-state";
import { useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ScatterChart,
  Scatter,
} from "recharts";
import {
  compareYears,
  correlations,
  exploreWorkouts,
  type Metric,
  type WorkoutFilters,
} from "../server/explore";
import type { Dashboard } from "./types";

const fmt = (n: number | null | undefined) =>
  n == null
    ? "--"
    : (Math.round(n * 10) / 10 || 0).toLocaleString(undefined, {
        maximumFractionDigits: 1,
      });
const labels: Record<Metric, string> = {
  strain: "Strain",
  sleep: "Sleep performance (%)",
  recovery: "Recovery (%)",
  hours: "Sleep hours",
  hrv: "HRV (ms)",
  rhr: "Resting heart rate (bpm)",
};
const zones = ["zero", "one", "two", "three", "four", "five"];
function MetricSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: Metric;
  onChange: (m: Metric) => void;
  options: Metric[];
}) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as Metric)}
      >
        {options.map((m) => (
          <option key={m} value={m}>
            {labels[m]}
          </option>
        ))}
      </select>
    </label>
  );
}
export function WorkoutExplorer({
  data,
  onSelect,
}: {
  data: Dashboard;
  onSelect: (date: string) => void;
}) {
  const [filters, setFilters] = useUrlState<WorkoutFilters>(
    "workoutFilters",
    {},
  );
  const [sort, setSort] = useUrlState("workoutSort", "newest");
  const [page, setPage] = useState(0);
  const result = exploreWorkouts(data.details, filters);
  const rows = result.rows.slice().sort((a, b) => {
    if (sort === "newest") return b.start.localeCompare(a.start);
    const av = sort === "duration" ? a.minutes : a.metrics.strain,
      bv = sort === "duration" ? b.minutes : b.metrics.strain;
    return (
      (bv ?? -Infinity) - (av ?? -Infinity) || b.start.localeCompare(a.start)
    );
  });
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const current = Math.min(page, pages - 1);
  const update = (key: keyof WorkoutFilters, value: string) => {
    setPage(0);
    setFilters((f) => ({
      ...f,
      [key]:
        value === ""
          ? undefined
          : key === "sport" || key === "zone"
            ? value
            : Number(value),
    }));
  };
  const sports = [
    ...new Set(
      data.details
        .filter((d) => d.kind === "workout")
        .map((d) => d.sport)
        .filter((s): s is string => !!s),
    ),
  ].sort();
  return (
    <section className="panel exploration" aria-label="Workout explorer">
      <h2>Workout explorer</h2>
      <p className="subtle">
        Workouts in the selected date range. Filters apply to the table and
        weekly totals. Unknown measurements are excluded only when that filter
        is active.
      </p>
      <div className="explore-controls">
        <label>
          Sport
          <select
            aria-label="Sport"
            value={filters.sport ?? ""}
            onChange={(e) => update("sport", e.target.value)}
          >
            <option value="">All sports</option>
            {sports.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        {(
          [
            ["minMinutes", "Min duration (min)"],
            ["maxMinutes", "Max duration (min)"],
            ["minStrain", "Min strain"],
            ["maxStrain", "Max strain"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min="0"
              max={key.includes("Strain") ? 21 : undefined}
              step="any"
              value={filters[key] ?? ""}
              onChange={(e) => update(key, e.target.value)}
            />
          </label>
        ))}
        <label>
          Heart-rate zone
          <select
            aria-label="Heart-rate zone"
            value={filters.zone ?? ""}
            onChange={(e) => update("zone", e.target.value)}
          >
            <option value="">Any zone</option>
            {zones.map((z, i) => (
              <option key={z} value={`zone_${z}_milli`}>
                Zone {i}
              </option>
            ))}
          </select>
        </label>
        <label>
          Min zone time (min)
          <input
            type="number"
            min="0"
            step="any"
            disabled={!filters.zone}
            value={filters.minZoneMinutes ?? ""}
            onChange={(e) => update("minZoneMinutes", e.target.value)}
          />
        </label>
        <label>
          Sort workouts
          <select
            aria-label="Sort workouts"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(0);
            }}
          >
            <option value="newest">Newest first</option>
            <option value="duration">Longest first</option>
            <option value="strain">Highest strain first</option>
          </select>
        </label>
        <button
          className="button secondary"
          onClick={() => {
            setFilters({});
            setPage(0);
          }}
        >
          Reset filters
        </button>
      </div>
      <p role="status">{rows.length} matching workouts</p>
      <h3>Weekly workout hours</h3>
      <p className="analytics-frequency">
        Weeks start Monday. Only known durations contribute; strain is never
        summed.
      </p>
      {rows.length > 0 ? (
        <>
          <div className="explore-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={result.weeks}>
                <CartesianGrid stroke="#26353d" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis />
                <Tooltip
                  formatter={(value) =>
                    fmt(typeof value === "number" ? value : null)
                  }
                  contentStyle={{
                    background: "#142127",
                    border: "1px solid #46565f",
                    borderRadius: 6,
                  }}
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="hours"
                  name="Workout hours"
                  fill="#24b6ed"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Sport</th>
                  <th>Minutes</th>
                  <th>Strain</th>
                  <th>Avg / max HR</th>
                  <th>Zone minutes (0-5)</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(current * 20, current * 20 + 20).map((r, i) => (
                  <tr key={r.start + r.sport + i}>
                    <td>{r.date}</td>
                    <td>{r.sport ?? "Unknown sport"}</td>
                    <td>{fmt(r.minutes)}</td>
                    <td>{fmt(r.metrics.strain)}</td>
                    <td>
                      {fmt(r.metrics.average_heart_rate)} /{" "}
                      {fmt(r.metrics.max_heart_rate)}
                    </td>
                    <td>
                      {zones
                        .map((z) =>
                          fmt(
                            r.metrics[`zone_${z}_milli`] == null
                              ? null
                              : r.metrics[`zone_${z}_milli`]! / 60000,
                          ),
                        )
                        .join(" / ")}
                    </td>
                    <td>
                      <button
                        className="button secondary"
                        onClick={() => onSelect(r.date)}
                      >
                        View {r.date}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Previous workouts
            </button>
            <span>
              Page {current + 1} of {pages}
            </span>
            <button
              disabled={current === pages - 1}
              onClick={() => setPage(current + 1)}
            >
              Next workouts
            </button>
          </div>
        </>
      ) : (
        <p className="analytics-empty">No workouts match these filters.</p>
      )}
    </section>
  );
}

export function PersonalCorrelations({
  data,
  onSelect,
}: {
  data: Dashboard;
  onSelect: (date: string) => void;
}) {
  const [x, setX] = useUrlState<Metric>("input", "hours"),
    [y, setY] = useUrlState<Metric>("outcome", "recovery"),
    [lag, setLag] = useUrlState<0 | 1>("lag", 0);
  const result = correlations(
    data.exploration.filter((d) => d.date >= data.start && d.date <= data.end),
    x,
    y,
    lag,
  );
  return (
    <section className="panel exploration" aria-label="Personal correlations">
      <h2>Personal correlations</h2>
      <p className="subtle">
        Explore associations in the selected date range. Both dates must be in
        range; missing days are never bridged or filled with zero.
      </p>
      <div className="explore-controls">
        <MetricSelect
          label="Input metric"
          value={x}
          onChange={setX}
          options={["hours", "sleep", "strain"]}
        />
        <MetricSelect
          label="Outcome metric"
          value={y}
          onChange={setY}
          options={["recovery", "hrv", "rhr", "hours"]}
        />
        <label>
          Outcome timing
          <select
            aria-label="Outcome timing"
            value={lag}
            onChange={(e) => setLag(Number(e.target.value) as 0 | 1)}
          >
            <option value={0}>Same cycle date</option>
            <option value={1}>Next calendar day</option>
          </select>
        </label>
      </div>
      <p className="correlation-result">
        Pearson r:{" "}
        <strong>{result.r === null ? "--" : result.r.toFixed(2)}</strong>{" "}
        <span>({result.count} paired days)</span>
      </p>
      <p className="analytics-frequency">
        Same-cycle sleep ends on the displayed date; next-day outcomes use
        exactly one calendar day later. Pearson r measures linear association
        from -1 to +1. Association does not establish cause; training, illness,
        travel, and WHOOP score inputs can affect both measures. Daily
        observations are not independent.
      </p>
      {result.r === null && (
        <p role="status">
          {result.count < 10
            ? "At least 10 paired days are needed to calculate a correlation."
            : "A correlation is undefined when either metric has no variation."}
        </p>
      )}
      {result.count > 0 ? (
        <div className="explore-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ bottom: 25, left: 10, right: 20 }}>
              <CartesianGrid stroke="#26353d" />
              <XAxis
                type="number"
                dataKey="x"
                name={labels[x]}
                label={{ value: labels[x], position: "bottom" }}
              />
              <YAxis type="number" dataKey="y" name={labels[y]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload;
                  return active && p ? (
                    <div className="explore-tooltip">
                      {p.date} → {p.outcomeDate}
                      <br />
                      {labels[x]}: {fmt(p.x)}
                      <br />
                      {labels[y]}: {fmt(p.y)}
                    </div>
                  ) : null;
                }}
              />
              <Scatter
                isAnimationActive={false}
                name={labels[y]}
                data={result.points}
                fill="#18d7bd"
                onClick={(p) => {
                  if (typeof p.payload?.date === "string")
                    onSelect(p.payload.date);
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="analytics-empty">No paired observations in this range.</p>
      )}
      <p className="subtle">
        Vertical axis: {labels[y]}. Select a point to inspect its input day.
      </p>
    </section>
  );
}

export function YearComparison({ data }: { data: Dashboard }) {
  const years = [
    ...new Set(data.exploration.map((d) => Number(d.date.slice(0, 4)))),
  ].sort((a, b) => b - a);
  const [first, setFirst] = useUrlState<number | null>("firstYear", null),
    [second, setSecond] = useUrlState<number | null>("secondYear", null),
    [metric, setMetric] = useUrlState<Metric>("yearMetric", "strain");
  const a = first !== null && years.includes(first) ? first : years[0],
    b = second !== null && years.includes(second) ? second : years[1];
  const rows = a && b ? compareYears(data.exploration, a, b, metric) : [];
  const count = rows.reduce((s, r) => s + r.count, 0);
  return (
    <section
      className="panel exploration"
      aria-label="Year-over-year comparisons"
    >
      <h2>Year-over-year comparisons</h2>
      <p className="subtle">
        All imported years, independent of the chart date range. Monthly
        averages use only month/day pairs with a recorded value in both years.
        Unmatched dates, including February 29 in a non-leap year, are excluded.
      </p>
      {years.length < 2 ? (
        <p className="analytics-empty">
          Import at least two years of history to compare years.
        </p>
      ) : (
        <>
          <div className="explore-controls">
            <label>
              First year
              <select
                aria-label="First year"
                value={a}
                onChange={(e) => setFirst(Number(e.target.value))}
              >
                {years.map((year) => (
                  <option key={year}>{year}</option>
                ))}
              </select>
            </label>
            <label>
              Second year
              <select
                aria-label="Second year"
                value={b}
                onChange={(e) => setSecond(Number(e.target.value))}
              >
                {years.map((year) => (
                  <option key={year}>{year}</option>
                ))}
              </select>
            </label>
            <MetricSelect
              label="Comparison metric"
              value={metric}
              onChange={setMetric}
              options={["strain", "sleep", "recovery", "hours", "hrv", "rhr"]}
            />
          </div>
          {a === b ? (
            <p role="status">Choose two different years.</p>
          ) : (
            <>
              <p>
                {count} matched calendar days · {labels[metric]}
              </p>
              {count === 0 ? (
                <p className="analytics-empty">
                  No matching scored dates for these years and metric.
                </p>
              ) : (
                <div className="explore-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={rows}>
                      <CartesianGrid stroke="#26353d" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip
                        formatter={(value) =>
                          fmt(typeof value === "number" ? value : null)
                        }
                        contentStyle={{
                          background: "#142127",
                          border: "1px solid #46565f",
                          borderRadius: 6,
                        }}
                      />
                      <Legend />
                      <Line
                        isAnimationActive={false}
                        dataKey="a"
                        name={String(a)}
                        stroke="#22baff"
                        connectNulls={false}
                      />
                      <Line
                        isAnimationActive={false}
                        dataKey="b"
                        name={String(b)}
                        stroke="#c6b4ff"
                        connectNulls={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>{a}</th>
                      <th>{b}</th>
                      <th>
                        Difference ({a} - {b})
                      </th>
                      <th>Matched days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.month}>
                        <td>{r.month}</td>
                        <td>{fmt(r.a)}</td>
                        <td>{fmt(r.b)}</td>
                        <td>
                          {r.a !== null && r.b !== null ? fmt(r.a - r.b) : "--"}
                        </td>
                        <td>{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
