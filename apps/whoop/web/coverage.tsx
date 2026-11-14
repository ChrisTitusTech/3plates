import type { Dashboard, Sync } from "./types";
export function Coverage({
  data,
  sync,
  onSelect,
}: {
  data: Dashboard;
  sync: Sync | null;
  onSelect: (date: string) => void;
}) {
  const days = data.completeness ?? [];
  const kinds = [
    ["cycle", "Strain"],
    ["sleep", "Sleep"],
    ["recovery", "Recovery"],
  ];
  const state = (day: (typeof days)[number], key: string) =>
    String((day as Record<string, unknown>)[key]);
  return (
    <section className="panel coverage">
      <h2>Data completeness</h2>
      <p className="subtle">
        Selected range. Missing means no imported record; pending means WHOOP
        has not finished scoring. An unscored record is present but has no
        score.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Scored</th>
              <th>Pending</th>
              <th>Unscored</th>
              <th>Missing</th>
              <th>Last successful import</th>
            </tr>
          </thead>
          <tbody>
            {kinds.map(([kind, label]) => {
              const imported = sync?.lastSuccessful?.find(
                (s) => s.kind === kind,
              )?.at;
              return (
                <tr key={kind}>
                  <td>{label}</td>
                  {["scored", "pending", "unscored", "missing"].map((s) => (
                    <td key={s}>
                      {days.filter((d) => state(d, kind) === s).length}
                    </td>
                  ))}
                  <td>
                    {imported
                      ? new Date(imported).toLocaleString()
                      : "No recent completed import"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details>
        <summary>Inspect days with gaps or unfinished scores</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Strain</th>
                <th>Sleep</th>
                <th>Recovery</th>
              </tr>
            </thead>
            <tbody>
              {days
                .filter((d) => kinds.some(([k]) => state(d, k) !== "scored"))
                .slice(-90)
                .reverse()
                .map((d) => (
                  <tr key={d.date}>
                    <td>
                      <button
                        className="button secondary"
                        onClick={() => onSelect(d.date)}
                      >
                        {d.date}
                      </button>
                    </td>
                    {kinds.map(([k]) => (
                      <td key={k}>{state(d, k)}</td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="subtle">
          Up to 90 most recent affected days. Use the date range to inspect
          older periods.
        </p>
      </details>
    </section>
  );
}
