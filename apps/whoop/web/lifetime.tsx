import type { Dashboard } from "./types";

const number = (value: number | null) =>
  value === null
    ? "--"
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 });

export function LifetimeStats({ stats }: { stats: Dashboard["lifetime"] }) {
  const metrics = [
    ["strain", "Average strain", ""],
    ["sleep", "Average sleep performance", "%"],
    ["recovery", "Average recovery", "%"],
    ["hours", "Average nightly sleep", " h"],
    ["hrv", "Average HRV", " ms"],
    ["rhr", "Average resting heart rate", " bpm"],
  ] as const;
  return (
    <section className="panel lifetime" aria-label="Lifetime statistics">
      <div className="panel-heading">
        <h2>Lifetime statistics</h2>
      </div>
      <p className="subtle">
        {stats.firstDate
          ? `${stats.firstDate} to ${stats.lastDate} · ${stats.daysRecorded.toLocaleString()} scored days`
          : "No imported history yet."}
      </p>
      <p className="analytics-frequency">
        All imported history, independent of the selected chart range. Each
        average excludes missing days; strain is never added together.
      </p>
      <div className="lifetime-grid">
        {metrics.map(([key, label, unit]) => {
          const metric = stats.metrics[key];
          return (
            <div className="lifetime-stat" key={key}>
              <h3>{label}</h3>
              <strong>
                {number(metric.average)}
                {metric.average !== null && unit}
              </strong>
              <p>{metric.count.toLocaleString()} recorded days</p>
              {metric.highest && (
                <p>
                  Highest: {number(metric.highest.value)}
                  {unit} on {metric.highest.date}
                </p>
              )}
              {metric.lowest && (
                <p>
                  Lowest: {number(metric.lowest.value)}
                  {unit} on {metric.lowest.date}
                </p>
              )}
            </div>
          );
        })}
        <div className="lifetime-stat">
          <h3>Total nightly sleep</h3>
          <strong>{number(stats.sleepHours)} h</strong>
          <p>{stats.nights.toLocaleString()} scored nights with duration</p>
          <p>Naps: {number(stats.napHours)} h separately</p>
        </div>
        <div className="lifetime-stat">
          <h3>Workouts</h3>
          <strong>{stats.workouts.toLocaleString()}</strong>
          <p>
            {number(stats.workoutHours)} hours across{" "}
            {stats.timedWorkouts.toLocaleString()} timed workouts
          </p>
        </div>
        <div className="lifetime-stat">
          <h3>Green recovery days</h3>
          <strong>{stats.greenRecoveryDays.toLocaleString()}</strong>
          <p>
            Of {stats.metrics.recovery.count.toLocaleString()} recorded recovery
            days (67% or higher)
          </p>
        </div>
      </div>
    </section>
  );
}
