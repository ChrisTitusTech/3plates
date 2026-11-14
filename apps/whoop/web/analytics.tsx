import { today } from "./dates";
import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  aggregateAnalytics,
  calendarYear,
  type CalendarDay,
} from "../server/analytics";
import type { Dashboard } from "./types";

type Series = {
  key: string;
  name: string;
  color: string;
  bar?: boolean;
  stack?: string;
  dashed?: boolean;
};
const clock = (value: number) => {
  const minutes = Math.round(value * 60) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
function AnalyticsChart({
  title,
  description,
  rows,
  series,
  unit,
  timing = false,
  onSelect,
}: {
  title: string;
  description: string;
  rows: { date: string }[];
  series: Series[];
  unit: string;
  timing?: boolean;
  onSelect: (date: string) => void;
}) {
  const data = useMemo(() => aggregateAnalytics(rows), [rows]);
  const hasData = data.points.some((p) => series.some((s) => p[s.key] != null));
  return (
    <section className="panel analytics-chart">
      <div className="panel-heading">
        <h3>{title}</h3>
        <span className="chart-unit">{unit}</span>
      </div>
      <p className="subtle">{description}</p>
      <p className="analytics-frequency">
        {data.mode === "day"
          ? "Daily values"
          : `${data.mode === "week" ? "Weekly" : "Monthly"} averages`}
      </p>
      {!hasData ? (
        <div className="analytics-empty">No scored data for this period.</div>
      ) : (
        <div
          className="chart-container"
          role="img"
          aria-label={`${title}; exact values in day details`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data.points}
              margin={{ top: 10, right: 12, left: -15, bottom: 0 }}
              onClick={(e: any) => {
                if (e?.activeLabel)
                  onSelect(
                    String(e.activeLabel) < rows[0].date
                      ? rows[0].date
                      : String(e.activeLabel),
                  );
              }}
            >
              <CartesianGrid
                vertical={false}
                stroke="#263035"
                strokeDasharray="3 4"
              />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                minTickGap={45}
                tick={{ fill: "#91a6ad", fontSize: 10 }}
              />
              <YAxis
                domain={timing ? [0, 36] : [0, "auto"]}
                tickFormatter={timing ? clock : undefined}
                tick={{ fill: "#91a6ad", fontSize: 10 }}
              />
              <Tooltip
                contentStyle={{
                  background: "#182125",
                  border: "1px solid #344048",
                  borderRadius: 8,
                }}
                labelFormatter={(v) => shortDate(String(v))}
                formatter={(v: any, name: any) => [
                  typeof v === "number"
                    ? timing
                      ? clock(v)
                      : `${v.toFixed(1)} ${unit}`
                    : "No data",
                  name,
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {series.map((s) =>
                s.bar ? (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.name}
                    fill={s.color}
                    stackId={s.stack}
                    isAnimationActive={false}
                  />
                ) : (
                  <Line
                    key={s.key}
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dashed ? "5 4" : undefined}
                    dot={rows.length < 8}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ),
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
export function SleepAnalytics({
  data,
  onSelect,
}: {
  data: Dashboard;
  onSelect: (date: string) => void;
}) {
  const rows = data.analytics.sleep;
  return (
    <section aria-label="Sleep analytics" className="analytics-section">
      <div className="section-heading">
        <h2>A closer look at your sleep</h2>
      </div>
      <p className="subtle">
        Main sleeps are averaged by WHOOP cycle date. Naps stay separate.
        Missing measurements remain gaps.
      </p>
      <div className="analytics-grid">
        <AnalyticsChart
          title="Sleep stages"
          description="Light, deep, and REM totals for complete scored nights; not a stage-by-stage timeline."
          rows={rows}
          unit="h"
          onSelect={onSelect}
          series={[
            {
              key: "light",
              name: "Light",
              color: "#7ba1bb",
              bar: true,
              stack: "stages",
            },
            {
              key: "deep",
              name: "Deep",
              color: "#7165c9",
              bar: true,
              stack: "stages",
            },
            {
              key: "rem",
              name: "REM",
              color: "#c3a5ee",
              bar: true,
              stack: "stages",
            },
          ]}
        />
        <AnalyticsChart
          title="Sleep and need"
          description="Main sleep versus WHOOP's calculated need, with its sleep-debt contribution and recorded naps."
          rows={rows}
          unit="h"
          onSelect={onSelect}
          series={[
            { key: "hours", name: "Asleep", color: "#7ba1bb" },
            { key: "need", name: "Need", color: "#b6f36b", dashed: true },
            { key: "debt", name: "Debt contribution", color: "#ffcc75" },
            { key: "napHours", name: "Naps", color: "#c3a5ee", bar: true },
          ]}
        />
        <AnalyticsChart
          title="Consistency and efficiency"
          description="WHOOP's scored percentages across the selected period."
          rows={rows}
          unit="%"
          onSelect={onSelect}
          series={[
            { key: "consistency", name: "Consistency", color: "#b6f36b" },
            { key: "efficiency", name: "Efficiency", color: "#7ba1bb" },
          ]}
        />
        <AnalyticsChart
          title="Sleep timing"
          description="Recorded local time. Bedtimes after midnight continue above 24:00; axis labels wrap to the clock."
          rows={rows}
          unit="local time"
          timing
          onSelect={onSelect}
          series={[
            { key: "bedtime", name: "Bedtime", color: "#c3a5ee" },
            { key: "wake", name: "Wake", color: "#ffcc75" },
          ]}
        />
      </div>
    </section>
  );
}
export function RecoveryAnalytics({
  data,
  onSelect,
}: {
  data: Dashboard;
  onSelect: (date: string) => void;
}) {
  const rows = data.analytics.recovery;
  const last = rows.at(-1);
  return (
    <section aria-label="Recovery analytics" className="analytics-section">
      <div className="section-heading">
        <h2>Your personal reference</h2>
      </div>
      <p className="subtle">
        The dashed baseline is the mean of the preceding 28 calendar days,
        excluding that day. Each metric needs at least 7 valid readings. These
        are personal comparisons, not diagnostic thresholds.
      </p>
      <p className="analytics-frequency">
        At the end of this range: HRV {last?.hrvCount ?? 0}/28 readings; resting
        heart rate {last?.rhrCount ?? 0}/28 readings. Baselines stay blank when
        there is insufficient history.
      </p>
      <div className="analytics-grid">
        <AnalyticsChart
          title="HRV and your baseline"
          description="Heart rate variability (RMSSD)."
          rows={rows}
          unit="ms"
          onSelect={onSelect}
          series={[
            { key: "hrv", name: "HRV", color: "#b6f36b" },
            {
              key: "hrvBaseline",
              name: "28-day baseline",
              color: "#91a6ad",
              dashed: true,
            },
          ]}
        />
        <AnalyticsChart
          title="Resting heart rate and your baseline"
          description="Your overnight resting heart rate."
          rows={rows}
          unit="bpm"
          onSelect={onSelect}
          series={[
            { key: "rhr", name: "Resting HR", color: "#7ba1bb" },
            {
              key: "rhrBaseline",
              name: "28-day baseline",
              color: "#91a6ad",
              dashed: true,
            },
          ]}
        />
      </div>
    </section>
  );
}

const metricNames = { recovery: "Recovery", strain: "Strain", sleep: "Sleep" };
function cellColor(metric: keyof typeof metricNames, value: number | null) {
  if (value === null) return "#253238";
  if (metric === "recovery")
    return value >= 67 ? "#66b755" : value >= 34 ? "#c4ad37" : "#bf4c5a";
  const level = Math.min(
    3,
    Math.floor((value / (metric === "strain" ? 21.01 : 100.01)) * 4),
  );
  return (
    metric === "strain"
      ? ["#173e56", "#24688c", "#2795c7", "#60c9ef"]
      : ["#34334c", "#625a88", "#9587ba", "#c7b5ec"]
  )[Math.max(0, level)];
}
export function YearCalendar({
  days,
  onSelect,
}: {
  days: CalendarDay[];
  onSelect: (date: string) => void;
}) {
  const now = today();
  const thisYear = Number(now.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [metric, setMetric] = useState<keyof typeof metricNames>("recovery");
  const firstYear = Math.min(
    thisYear,
    ...days.map((d) => Number(d.date.slice(0, 4))),
  );
  const values = useMemo(() => calendarYear(days, year), [days, year]);
  const scored = values.filter(
    (d) => d.date <= now && d[metric] !== null,
  ).length;
  return (
    <section className="panel year-calendar" aria-label="Yearly calendar">
      <div className="panel-heading">
        <h2>Your year at a glance</h2>
        <div className="calendar-controls">
          <label>
            Metric
            <select
              aria-label="Calendar metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value as typeof metric)}
            >
              {Object.entries(metricNames).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select
              aria-label="Calendar year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {Array.from(
                { length: thisYear - firstYear + 1 },
                (_, i) => thisYear - i,
              ).map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <p className="subtle">
        {scored} scored days in {year}. Independent of the chart date range.
        Select a day to explore.
      </p>
      <div className="calendar-months">
        {Array.from({ length: 12 }, (_, month) => {
          const monthDays = values.filter(
            (d) => Number(d.date.slice(5, 7)) === month + 1,
          );
          const offset =
            (new Date(`${monthDays[0].date}T00:00:00Z`).getUTCDay() + 6) % 7;
          return (
            <div className="calendar-month" key={month}>
              <h3>
                {new Date(Date.UTC(year, month, 1)).toLocaleDateString(
                  undefined,
                  { month: "long", timeZone: "UTC" },
                )}
              </h3>
              <div className="calendar-weekdays" aria-hidden="true">
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                  <span key={i}>{d}</span>
                ))}
              </div>
              <div className="calendar-days">
                {monthDays.map((d, i) => {
                  const future = d.date > now;
                  const value = d[metric];
                  const label = `${d.date}: ${metricNames[metric]} ${future ? "future date" : value === null ? "no data" : `${value.toFixed(1)}${metric === "strain" ? " / 21" : "%"}`}`;
                  return (
                    <button
                      key={d.date}
                      style={{
                        background: cellColor(metric, future ? null : value),
                        gridColumnStart: i === 0 ? offset + 1 : undefined,
                      }}
                      disabled={future}
                      aria-label={label}
                      title={label}
                      onClick={() => onSelect(d.date)}
                    >
                      {Number(d.date.slice(8))}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="calendar-legend">
        <span>
          <i style={{ background: "#253238" }} />
          No data
        </span>
        {(metric === "recovery"
          ? [
              [20, "0-33%"],
              [50, "34-66%"],
              [80, "67-100%"],
            ]
          : metric === "strain"
            ? [
                [0, "0-5.2"],
                [8, "5.3-10.4"],
                [14, "10.5-15.7"],
                [21, "15.8-21"],
              ]
            : [
                [0, "0"],
                [35, "25"],
                [65, "50"],
                [100, "75-100%"],
              ]
        ).map(([value, label]) => (
          <span key={label}>
            <i style={{ background: cellColor(metric, Number(value)) }} />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}
