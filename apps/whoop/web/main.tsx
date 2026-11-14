import { Coverage } from "./coverage";
import { today, ago } from "./dates";
import { useUrlState } from "./url-state";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  HeartPulse,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Moon,
  Mountain,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Dashboard, Member, Sync } from "./types";
import { sample } from "./demo";
import {
  WorkoutExplorer,
  PersonalCorrelations,
  YearComparison,
} from "./explore";
import { LifetimeStats } from "./lifetime";
import "./style.css";
import { SleepAnalytics, RecoveryAnalytics, YearCalendar } from "./analytics";

const fmt = (n: number | null | undefined, digits = 1) =>
  n == null ? "--" : n.toFixed(digits);
const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const recoveryColor = (n: number | null) =>
  n == null ? "#55616b" : n >= 67 ? "#16ec06" : n >= 34 ? "#ffde00" : "#ff0026";
async function api<T>(
  url: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? undefined
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error ?? "Request failed"), {
      status: response.status,
    });
  return data;
}
function App() {
  const shared = location.pathname.startsWith("/share/")
    ? location.pathname.split("/")[2]
    : null;
  const demo = location.pathname === "/demo";
  const privacy = location.pathname === "/privacy";
  const [member, setMember] = useState<Member | null>(null);
  const [loaded, setLoaded] = useState(demo || !!shared || privacy);
  const [data, setData] = useState<Dashboard | null>(null);
  const [sync, setSync] = useState<Sync | null>(null);
  const [range, setRange] = useUrlState("range", "30");
  const [start, setStart] = useUrlState("start", ago(29));
  const [end, setEnd] = useUrlState("end", today());
  const [historyPage, setHistoryPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useUrlState("tab", "overview");
  const [settings, setSettings] = useState(false);
  const [sharePreview, setSharePreview] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 800px)").matches,
  );
  const menuButton = useRef<HTMLButtonElement>(null);
  const wasMenuOpen = useRef(false);
  useEffect(() => {
    if (wasMenuOpen.current && !menu) menuButton.current?.focus();
    wasMenuOpen.current = menu;
  }, [menu]);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = matchMedia("(max-width: 800px)");
    const change = () => setMobile(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!menu || !mobile) return;
    sidebar.current?.querySelector<HTMLElement>("button, a")?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        menuButton.current?.focus();
      }
      if (e.key === "Tab") {
        const items = [
          ...(sidebar.current?.querySelectorAll<HTMLElement>(
            "a[href],button:not(:disabled)",
          ) ?? []),
        ];
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menu, mobile]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [revision, setRevision] = useState(0);
  const requestId = useRef(0);
  const historyData = useRef<Dashboard | null>(null);
  const [shareDraft, setShareDraft] = useState<
    import("../server/history").SharePolicy
  >({ kinds: ["cycle", "sleep", "recovery", "workout"] });
  useEffect(() => {
    if (member?.sharePolicy) setShareDraft(member.sharePolicy);
    else if (member?.shareUrl)
      setShareDraft({
        kinds: ["cycle", "sleep", "recovery", "workout", "body"],
      });
  }, [member?.sharePolicy, member?.shareUrl]);
  useEffect(() => {
    if (!demo && !shared && !privacy)
      api<Member>("/api/me")
        .then(setMember)
        .catch((e) => {
          if (e.status !== 401) setError(e.message);
        })
        .finally(() => setLoaded(true));
  }, [demo, shared, privacy]);
  useEffect(() => {
    if (!member && !shared && !demo) return;
    const id = ++requestId.current;
    if (!start || !end) {
      setError("Choose both a start and end date.");
      return;
    }
    if (start > end) {
      setError("The start date must be before the end date.");
      return;
    }
    if (demo) {
      setData(sample(start, end));
      setError("");
      return;
    }
    setBusy(true);
    api<Dashboard>(
      (shared
        ? `/api/shared/${encodeURIComponent(shared)}`
        : "/api/me/dashboard") +
        `?start=${start}&end=${end}${historyData.current?.contextVersion ? "&context=" + encodeURIComponent(historyData.current.contextVersion) : ""}`,
    )
      .then((d) => {
        if (id === requestId.current) {
          const merged = {
            ...historyData.current,
            ...d,
            analytics: { ...historyData.current?.analytics, ...d.analytics },
          };
          historyData.current = merged;
          setData(merged);
          setError("");
        }
      })
      .catch((e) => {
        if (id === requestId.current) setError(e.message);
      })
      .finally(() => {
        if (id === requestId.current) setBusy(false);
      });
  }, [member, shared, demo, start, end, revision]);
  useEffect(() => {
    if (!member || shared) return;
    let active = true;
    let previousSync = "";
    const refresh = () =>
      api<Sync>("/api/me/sync")
        .then((s) => {
          if (!active) return;
          setSync(s);
          if (s.lastSync && s.lastSync !== previousSync) {
            previousSync = s.lastSync;
            setRevision((r) => r + 1);
          }
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [member, shared]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(() => {
    setHistoryPage(0);
  }, [start, end]);
  const historyRows =
    data?.days
      .filter(
        (d) => d.strain !== null || d.sleep !== null || d.recovery !== null,
      )
      .slice()
      .reverse() ?? [];
  const changeRange = (value: string) => {
    setRange(value);
    if (value !== "custom") {
      setEnd(today());
      setStart(
        value === "all" ? (data?.earliest ?? ago(364)) : ago(Number(value) - 1),
      );
    }
  };
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const signed = !!member;
  const viewing = signed || !!shared || demo;
  const pending =
    sync?.jobs.filter((j) => ["pending", "running"].includes(j.status)) ?? [];
  const failed = sync?.jobs.filter((j) => j.status === "failed") ?? [];
  const connected = sync?.connected ?? member?.connected;
  const signout = () =>
    action(async () => {
      await api("/api/logout", {});
      location.href = "/";
    });
  const share = (enabled: boolean) =>
    action(async () => {
      const s = await api<{ shareUrl: string | null }>("/api/me/sharing", {
        enabled,
        ...(enabled ? { policy: shareDraft } : {}),
      });
      setMember(
        (m) =>
          m && { ...m, ...s, ...(enabled ? { sharePolicy: shareDraft } : {}) },
      );
      setSharePreview(false);
      setToast(
        enabled
          ? "Your public link is ready."
          : "Sharing is off. The old link no longer works.",
      );
    });
  return (
    <div className="app">
      <aside
        ref={sidebar}
        id="navigation"
        inert={mobile && !menu}
        className={"sidebar " + (menu ? "open" : "")}
      >
        <a href="/" className="brand">
          <span className="brand-icon">
            <Mountain size={23} />
          </span>
          gallant<span className="brand-dot">.</span>
        </a>
        <span className="side-caption">YOUR PERFORMANCE, IN PERSPECTIVE</span>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {mobile && menu && (
            <button
              className="nav"
              onClick={() => {
                setMenu(false);
                menuButton.current?.focus();
              }}
            >
              Close navigation
            </button>
          )}
          {[
            [LayoutDashboard, "overview", "Overview"],
            [Zap, "strain", "Strain"],
            [Moon, "sleep", "Sleep"],
            [HeartPulse, "recovery", "Recovery"],
            [Activity, "workouts", "Workouts"],
            [Sparkles, "correlations", "Correlations"],
            [CalendarDays, "years", "Year comparisons"],
          ].map(([Icon, id, label]) => {
            const I = Icon as typeof Zap;
            return (
              <button
                key={id as string}
                className={tab === id ? "nav active" : "nav"}
                onClick={() => {
                  setTab(id as string);
                  setMenu(false);
                  if (mobile) menuButton.current?.focus();
                  if (!viewing) location.href = "/demo";
                }}
              >
                <I size={18} />
                {label as string}
                {tab === id && <span className="nav-dot" />}
              </button>
            );
          })}
          <button
            className="nav"
            onClick={() => {
              document
                .getElementById("history")
                ?.scrollIntoView({ behavior: "smooth" });
              setMenu(false);
            }}
          >
            <CalendarDays size={18} />
            History
          </button>
        </nav>
        <div className="side-bottom">
          <div className="connection">
            <span className={"status-dot " + (!viewing ? "muted" : "")} />
            {demo
              ? "Demo workspace"
              : shared
                ? "Shared dashboard"
                : signed
                  ? connected
                    ? "WHOOP connected"
                    : "Connection paused"
                  : "Connect your WHOOP"}
            <small>
              {demo ? "Illustrative data only" : "Strain. Sleep. Recovery."}
            </small>
          </div>
          {signed && (
            <button className="nav" onClick={() => setSettings(true)}>
              <Settings2 size={18} />
              Account & sharing
            </button>
          )}
          <a className="nav" href="/privacy">
            <ShieldCheck size={18} />
            Privacy
          </a>
          {signed && (
            <button className="profile" onClick={signout}>
              <span className="avatar">
                {member.name
                  .split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span>
                {member.name}
                <small>Sign out</small>
              </span>
              <LogOut size={16} />
            </button>
          )}
        </div>
      </aside>
      <main inert={mobile && menu}>
        <header className="topbar">
          <button
            className="icon-button mobile-toggle"
            ref={menuButton}
            aria-controls="navigation"
            aria-expanded={menu}
            aria-label="Open navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumbs">
            Workspace <ChevronRight size={14} />
            <span>
              {privacy ? "Privacy" : tab[0].toUpperCase() + tab.slice(1)}
            </span>
          </div>
          <div className="top-actions">
            <span className="powered">
              DATA BY <strong>WHOOP</strong>
            </span>
            {viewing && (
              <span className="pill">
                <span className="status-dot" />
                {demo ? "Demo" : shared ? "Public view" : "Personal"}
              </span>
            )}
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {toast && (
            <div className="notice" role="status">
              <Check size={16} />
              {toast}
            </div>
          )}
          {privacy ? (
            <Privacy />
          ) : !loaded ? (
            <div className="empty">Opening your workspace...</div>
          ) : !viewing ? (
            <Landing />
          ) : (
            <>
              {demo && (
                <div className="demo-banner">
                  <Sparkles size={15} />
                  <span>
                    Explore a sample dashboard. All values are illustrative.
                  </span>
                  <a href="/auth/whoop">
                    Connect your WHOOP <ArrowRight size={14} />
                  </a>
                </div>
              )}
              {shared && (
                <div className="demo-banner">
                  <Link2 size={15} />
                  This dashboard was shared by {data?.name ?? "its owner"}.{" "}
                  <a href="/">
                    Create your own <ArrowRight size={14} />
                  </a>
                </div>
              )}
              <div className="page-heading">
                <div>
                  <div className="eyebrow">THE BIG PICTURE</div>
                  <h1>
                    {tab === "overview"
                      ? "Your effort. Your rhythm."
                      : tab === "strain"
                        ? "Every effort adds up."
                        : tab === "sleep"
                          ? "Make room for recovery."
                          : tab === "workouts"
                            ? "Explore your training."
                            : tab === "correlations"
                              ? "Find your patterns."
                              : tab === "years"
                                ? "See your progress over years."
                                : "Find your balance."}
                  </h1>
                  <p>
                    {shared
                      ? `${data?.name ?? "Member"}'s performance history.`
                      : "A clearer view of your strain, sleep, and recovery over time."}
                  </p>
                </div>
                <div className="heading-actions">
                  {signed && (
                    <button
                      className="button secondary"
                      disabled={busy || !connected}
                      onClick={() =>
                        action(async () => {
                          await api("/api/me/sync", {});
                          setRevision((r) => r + 1);
                          setToast(
                            "Sync queued. New data will appear automatically.",
                          );
                        })
                      }
                    >
                      <RefreshCw
                        size={15}
                        className={pending.length ? "spin" : ""}
                      />
                      Sync now
                    </button>
                  )}
                  {signed && (
                    <button
                      className="button secondary"
                      onClick={() => setSettings(true)}
                    >
                      <Link2 size={15} />
                      Share
                    </button>
                  )}
                </div>
              </div>
              {signed && !connected && (
                <div className="notice">
                  Your history is saved. Reconnect WHOOP to resume updates.
                  <a className="text-link" href="/auth/whoop">
                    Reconnect <ArrowRight size={14} />
                  </a>
                </div>
              )}
              {!!pending.length && (
                <div className="sync-status" role="status">
                  <RefreshCw size={14} className="spin" />
                  Importing your history:{" "}
                  {pending
                    .reduce((a, j) => a + j.count, 0)
                    .toLocaleString()}{" "}
                  records processed across {pending.length} tasks. You can leave
                  this page.
                </div>
              )}
              {!!failed.length && (
                <div className="notice error">
                  Some imports need attention. {failed[0].error}
                  <button
                    onClick={() =>
                      action(async () => {
                        await api("/api/me/sync", { full: true });
                        setToast("Full history retry queued.");
                      })
                    }
                  >
                    Retry full history
                  </button>
                </div>
              )}
              <div className="rangebar">
                <div className="range-tabs" aria-label="Date range">
                  {[
                    ["7", "7 days"],
                    ["30", "30 days"],
                    ["90", "90 days"],
                    ["365", "1 year"],
                    ["all", "All time"],
                    ["custom", "Custom"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={range === value ? "selected" : ""}
                      onClick={() => changeRange(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="date-fields">
                  <CalendarDays size={15} />
                  <input
                    type="date"
                    aria-label="Start date"
                    value={start}
                    onChange={(e) => {
                      setRange("custom");
                      setStart(e.target.value);
                    }}
                  />
                  <span>to</span>
                  <input
                    type="date"
                    aria-label="End date"
                    value={end}
                    onChange={(e) => {
                      setRange("custom");
                      setEnd(e.target.value);
                    }}
                  />
                </div>
              </div>
              {!data ? (
                <div className="empty">
                  {busy
                    ? "Loading your history..."
                    : "No dashboard is available."}
                </div>
              ) : (
                <>
                  <div className="metrics-grid">
                    <MetricCard
                      data={data}
                      metric="strain"
                      label="STRAIN"
                      color="#0093e7"
                      Icon={Zap}
                      unit=" / 21"
                    />
                    <MetricCard
                      data={data}
                      metric="sleep"
                      label="SLEEP PERFORMANCE"
                      color="#7ba1bb"
                      Icon={Moon}
                      unit="%"
                    />
                    <MetricCard
                      data={data}
                      metric="recovery"
                      label="RECOVERY"
                      color="#16ec06"
                      Icon={HeartPulse}
                      unit="%"
                    />
                  </div>
                  <p className="comparison-note">
                    Changes compare with {dateLabel(data.previousStart)} to{" "}
                    {dateLabel(data.previousEnd)},{" "}
                    {data.previousEnd.slice(0, 4)}. Both periods use available
                    scored days.
                  </p>
                  {!data.earliest && (
                    <div className="empty">
                      <Activity size={28} />
                      <h2>Your history starts here.</h2>
                      <p>
                        {pending.length
                          ? "We are importing your WHOOP records. Charts will fill in as each page arrives."
                          : "No WHOOP records have been imported yet. Connect or sync your account to begin."}
                      </p>
                    </div>
                  )}
                  {tab === "workouts" ? (
                    <WorkoutExplorer
                      key={start + end}
                      data={data}
                      onSelect={setSelected}
                    />
                  ) : tab === "correlations" ? (
                    <PersonalCorrelations data={data} onSelect={setSelected} />
                  ) : tab === "years" ? (
                    <YearComparison data={data} />
                  ) : (
                    <>
                      <div className="section-heading">
                        <h2>
                          {tab === "overview"
                            ? "Performance trends"
                            : `${tab[0].toUpperCase() + tab.slice(1)} trends`}
                        </h2>
                        <span>
                          {data.chart.mode === "day"
                            ? "Daily values"
                            : `${data.chart.mode === "week" ? "Weekly" : "Monthly"} averages`}
                          <span className="separator">/</span>Click a chart to
                          explore
                        </span>
                      </div>
                      <div className="charts-grid">
                        {(tab === "overview"
                          ? ["strain", "sleep", "recovery"]
                          : [tab]
                        ).map((metric) => (
                          <Chart
                            key={metric}
                            metric={metric}
                            data={data}
                            onSelect={setSelected}
                          />
                        ))}
                      </div>
                      {tab === "sleep" && (
                        <SleepAnalytics data={data} onSelect={setSelected} />
                      )}
                      {tab === "recovery" && (
                        <RecoveryAnalytics data={data} onSelect={setSelected} />
                      )}
                      {tab === "overview" && (
                        <LifetimeStats stats={data.lifetime} />
                      )}
                      {tab === "overview" && (
                        <YearCalendar
                          days={data.analytics.calendar}
                          onSelect={(date) => {
                            if (date < start || date > end) {
                              setRange("custom");
                              setStart(date);
                              setEnd(date);
                            }
                            setSelected(date);
                          }}
                        />
                      )}
                    </>
                  )}
                  {signed && data.completeness && (
                    <Coverage data={data} sync={sync} onSelect={setSelected} />
                  )}
                  <div className="lower-grid">
                    <section className="panel highlights">
                      <div className="panel-heading">
                        <h2>Your reference points</h2>
                        <Activity size={18} />
                      </div>
                      <p className="subtle">Averages for the selected period</p>
                      <div className="reference-row">
                        <span>Heart rate variability</span>
                        <strong>
                          {fmt(data.summary.hrv?.value)} <small>ms</small>
                        </strong>
                      </div>
                      <div className="reference-row">
                        <span>Resting heart rate</span>
                        <strong>
                          {fmt(data.summary.rhr?.value, 0)} <small>bpm</small>
                        </strong>
                      </div>
                      <div className="reference-row">
                        <span>Time asleep</span>
                        <strong>
                          {fmt(data.summary.hours?.value)} <small>hours</small>
                        </strong>
                      </div>
                      <div className="reference-note">
                        <CircleHelp size={16} />
                        <span>
                          Missing and unscored records are excluded. Strain
                          values are averaged, never added.
                        </span>
                      </div>
                    </section>
                    <section className="panel history" id="history">
                      <div className="panel-heading">
                        <h2>History, day by day</h2>
                        {signed && (
                          <a
                            className="text-link"
                            href="/api/me/export?format=csv"
                          >
                            <ArrowDownToLine size={15} />
                            Export CSV
                          </a>
                        )}
                      </div>
                      <div className="history-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Strain</th>
                              <th>Sleep</th>
                              <th>Recovery</th>
                              <th>
                                <span className="sr-only">Details</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyRows
                              .slice(historyPage * 30, (historyPage + 1) * 30)
                              .map((d) => (
                                <tr key={d.date}>
                                  <td>
                                    <button
                                      className="date-button"
                                      onClick={() => setSelected(d.date)}
                                    >
                                      {dateLabel(d.date)}
                                      <small>{d.date.slice(0, 4)}</small>
                                    </button>
                                  </td>
                                  <td className="strain-text">
                                    {fmt(d.strain)}
                                  </td>
                                  <td>
                                    {fmt(d.sleep, 0)}
                                    {d.sleep != null && "%"}
                                  </td>
                                  <td>
                                    <span
                                      className="recovery-number"
                                      style={{
                                        color: recoveryColor(d.recovery),
                                      }}
                                    >
                                      <i
                                        style={{
                                          background: recoveryColor(d.recovery),
                                        }}
                                      />
                                      {fmt(d.recovery, 0)}
                                      {d.recovery != null && "%"}
                                    </span>
                                  </td>
                                  <td>
                                    <button
                                      className="icon-button"
                                      aria-label={`View ${d.date}`}
                                      onClick={() => setSelected(d.date)}
                                    >
                                      <ArrowUpRight size={16} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        {data.days.every(
                          (d) =>
                            d.strain === null &&
                            d.sleep === null &&
                            d.recovery === null,
                        ) && (
                          <p className="table-empty">
                            No scored records in this range.
                          </p>
                        )}
                      </div>
                      <div className="pagination">
                        <button
                          disabled={historyPage === 0}
                          onClick={() => setHistoryPage((p) => p - 1)}
                        >
                          Previous
                        </button>
                        <span>
                          Page {historyPage + 1} of{" "}
                          {Math.max(1, Math.ceil(historyRows.length / 30))}
                        </span>
                        <button
                          disabled={
                            (historyPage + 1) * 30 >= historyRows.length
                          }
                          onClick={() => setHistoryPage((p) => p + 1)}
                        >
                          Next
                        </button>
                      </div>
                    </section>
                  </div>
                  {data.body && (
                    <section className="panel body-panel">
                      <div className="panel-heading">
                        <h2>Body measurements</h2>
                        <span className="subtle">
                          Latest snapshot: {data.body.date}
                        </span>
                      </div>
                      <div className="body-values">
                        {Object.entries(data.body.metrics).map(([k, v]) => (
                          <div key={k}>
                            <span>{k.replaceAll("_", " ")}</span>
                            <strong>{fmt(v)}</strong>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  <footer>
                    <span>
                      <Clock3 size={13} />
                      {demo
                        ? "Sample data - not a real WHOOP account"
                        : data.lastSync
                          ? `Last imported ${new Date(data.lastSync).toLocaleString()}`
                          : "Waiting for first import"}
                    </span>
                    <span>
                      {data.earliest
                        ? `History since ${dateLabel(data.earliest)}, ${data.earliest.slice(0, 4)}`
                        : "Your history belongs to you."}
                    </span>
                  </footer>
                </>
              )}
            </>
          )}
        </div>
      </main>
      {selected && data && (
        <Modal
          title={dateLabel(selected) + ", " + selected.slice(0, 4)}
          onClose={() => setSelected(null)}
        >
          <p className="subtle">
            Records are grouped by WHOOP physiological cycle where available.
            Record timestamps are UTC; bedtime and wake-hour metrics use the
            recorded local offset.
          </p>
          {data.analytics.recovery
            .filter((d) => d.date === selected)
            .map((d) => (
              <div className="detail-block" key="baseline">
                <h3>PERSONAL BASELINES</h3>
                <p className="subtle">
                  Preceding 28 days; at least 7 readings per metric.
                </p>
                <dl>
                  <dt>HRV baseline</dt>
                  <dd>
                    {fmt(d.hrvBaseline)} ms ({d.hrvCount} readings)
                  </dd>
                  <dt>Resting heart rate baseline</dt>
                  <dd>
                    {fmt(d.rhrBaseline)} bpm ({d.rhrCount} readings)
                  </dd>
                </dl>
              </div>
            ))}
          {data.chart.mode !== "day" && (
            <label className="field-label">
              Explore another day
              <input
                type="date"
                value={selected}
                min={start}
                max={end}
                onChange={(e) => setSelected(e.target.value)}
              />
            </label>
          )}
          {data.details
            .filter((d) => d.date === selected)
            .map((d, i) => (
              <div className="detail-block" key={i}>
                <h3>
                  {d.kind.toUpperCase()}
                  {d.nap ? " / NAP" : ""}
                  {d.sport ? ` / ${d.sport}` : ""}
                </h3>
                <p className="subtle">
                  {d.state.replaceAll("_", " ")} |{" "}
                  {new Date(d.start).toLocaleTimeString(undefined, {
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </p>
                <dl>
                  {Object.entries(d.metrics).map(([key, value]) => (
                    <React.Fragment key={key}>
                      <dt>{key.replaceAll("_", " ")}</dt>
                      <dd>
                        {key.endsWith("_milli") && !key.startsWith("hrv")
                          ? `${fmt(value == null ? null : value / 60000, 0)} min`
                          : fmt(value)}
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            ))}
          {!data.details.some((d) => d.date === selected) && (
            <p>No records for this day. Choose another date.</p>
          )}
        </Modal>
      )}
      {settings && member && (
        <Modal title="Account & sharing" onClose={() => setSettings(false)}>
          <p className="subtle">
            Connected as {member.name}. Your dashboard is private unless you
            enable a public link.
          </p>
          <section className="settings-section">
            <h3>Choose what to share</h3>
            <p>
              A public link includes your name and the data you select. Anyone
              with the link can view it until it expires or you revoke it.
              Account details and exports stay private.
            </p>
            <div className="share-options">
              <fieldset>
                <legend>Shared metrics</legend>
                {[
                  ["cycle", "Strain"],
                  ["sleep", "Sleep"],
                  ["recovery", "Recovery"],
                  ["workout", "Workouts"],
                  ["body", "Body measurements"],
                ].map(([kind, label]) => (
                  <label key={kind}>
                    <input
                      type="checkbox"
                      checked={shareDraft.kinds.includes(kind)}
                      onChange={(e) =>
                        setShareDraft((p) => ({
                          ...p,
                          kinds: e.target.checked
                            ? [...p.kinds, kind]
                            : p.kinds.filter((k) => k !== kind),
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <label>
                Share from
                <input
                  type="date"
                  value={shareDraft.start ?? ""}
                  onChange={(e) =>
                    setShareDraft((p) => ({
                      ...p,
                      start: e.target.value || undefined,
                    }))
                  }
                />
              </label>
              <label>
                Share through
                <input
                  type="date"
                  value={shareDraft.end ?? ""}
                  onChange={(e) =>
                    setShareDraft((p) => ({
                      ...p,
                      end: e.target.value || undefined,
                    }))
                  }
                />
              </label>
              <label>
                Expires at (UTC)
                <input
                  type="datetime-local"
                  value={shareDraft.expires?.slice(0, 16) ?? ""}
                  onChange={(e) =>
                    setShareDraft((p) => ({
                      ...p,
                      expires: e.target.value
                        ? e.target.value + ":00.000Z"
                        : undefined,
                    }))
                  }
                />
              </label>
            </div>
            {member.shareUrl ? (
              <>
                <label className="field-label">
                  Public dashboard link
                  <input
                    readOnly
                    value={member.shareUrl}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <div className="button-row">
                  <button
                    className="button"
                    onClick={() =>
                      action(async () => {
                        await navigator.clipboard.writeText(member.shareUrl!);
                        setToast("Link copied.");
                      })
                    }
                  >
                    Copy link
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || !shareDraft.kinds.length}
                    onClick={() => share(true)}
                  >
                    Save sharing restrictions
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => share(false)}
                  >
                    Turn off sharing
                  </button>
                </div>
              </>
            ) : (
              <button
                className="button"
                onClick={() => {
                  setSettings(false);
                  setSharePreview(true);
                }}
              >
                Preview public sharing <ArrowRight size={15} />
              </button>
            )}
          </section>
          <section className="settings-section">
            <h3>Your data</h3>
            {data?.body && (
              <dl>
                {Object.entries(data.body.metrics).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt>{k.replaceAll("_", " ")}</dt>
                    <dd>{fmt(v)}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
            <div className="button-row">
              <a className="button secondary" href="/api/me/export?format=json">
                Download JSON
              </a>
              <button
                className="button secondary"
                disabled={busy || !connected}
                onClick={() =>
                  action(async () => {
                    await api("/api/me/sync", { full: true });
                    setToast("Complete history refresh queued.");
                  })
                }
              >
                Refresh all history
              </button>
            </div>
            <p>
              Disconnecting stops updates and public sharing. Your private
              history stays available. Deleting your account removes active
              data; backups expire within 14 days.
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={busy || !connected}
                onClick={() => {
                  if (
                    confirm(
                      "Disconnect WHOOP and disable your public link? Your imported history will be retained.",
                    )
                  )
                    void action(async () => {
                      await api("/api/me/disconnect", {});
                      setMember(
                        (m) => m && { ...m, connected: false, shareUrl: null },
                      );
                      setToast("WHOOP disconnected.");
                    });
                }}
              >
                Disconnect
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Permanently delete your account and imported history?",
                    )
                  )
                    void action(async () => {
                      await api("/api/me", {}, "DELETE");
                      location.href = "/";
                    });
                }}
              >
                Delete my account
              </button>
            </div>
          </section>
        </Modal>
      )}
      {sharePreview && (
        <Modal
          title="Public dashboard preview"
          onClose={() => setSharePreview(false)}
        >
          <div className="preview-card">
            <span className="pill">
              <Link2 size={13} />
              Public view
            </span>
            <h2>{member?.name}</h2>
            <div className="preview-values">
              {["strain", "sleep", "recovery"].map((k) => (
                <div key={k}>
                  <small>{k}</small>
                  <strong>{fmt(data?.summary[k]?.value)}</strong>
                </div>
              ))}
            </div>
            <p>
              Visitors can see:{" "}
              {shareDraft.kinds
                .map((k) => (k === "cycle" ? "strain" : k))
                .join(", ")}
              . Date limits: {shareDraft.start ?? "earliest"} to{" "}
              {shareDraft.end ?? "latest"}. Expires:{" "}
              {shareDraft.expires ?? "never"}. Unselected metrics are excluded
              by the server.
            </p>
          </div>
          <p>
            Your email, account settings, exports, and credentials are excluded.
            You can revoke the link at any time.
          </p>
          <button
            className="button"
            disabled={busy || !shareDraft.kinds.length}
            onClick={() => share(true)}
          >
            Enable dashboard sharing <ArrowRight size={15} />
          </button>
        </Modal>
      )}
    </div>
  );
}
function MetricCard({
  data,
  metric,
  label,
  color,
  Icon,
  unit,
}: {
  data: Dashboard;
  metric: string;
  label: string;
  color: string;
  Icon: typeof Zap;
  unit: string;
}) {
  const current = data.summary[metric];
  if (metric === "recovery") color = recoveryColor(current?.value ?? null);
  const prev = data.previous[metric];
  const delta =
    current?.value != null && prev?.value != null
      ? current.value - prev.value
      : null;
  return (
    <section className="metric-card">
      <div className="metric-label">
        <span>{label}</span>
        <span
          className="metric-icon"
          style={{ color, background: color + "12" }}
        >
          <Icon size={19} />
        </span>
      </div>
      <div className="metric-value">
        {fmt(current?.value, metric === "strain" ? 1 : 0)}
        <span>{unit}</span>
        <span className="average-label">AVG</span>
      </div>
      <div className="sparkline" aria-hidden="true">
        <ResponsiveContainer width="100%" height={46}>
          <AreaChart data={data.chart.points}>
            <defs>
              <linearGradient id={"fade-" + metric} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey={metric}
              stroke={color}
              fill={`url(#fade-${metric})`}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="metric-caption">
        <span style={{ color }}>
          {delta === null
            ? "No prior comparison"
            : `${delta >= 0 ? "+" : ""}${fmt(delta)} ${metric === "strain" ? "" : "pts"}`}
        </span>
        <span>{current?.count ?? 0} scored days</span>
      </div>
    </section>
  );
}
function Chart({
  data,
  metric,
  onSelect,
}: {
  data: Dashboard;
  metric: string;
  onSelect: (date: string) => void;
}) {
  const color =
    metric === "strain"
      ? "#0093e7"
      : metric === "sleep"
        ? "#7ba1bb"
        : "#16ec06";
  const axis = {
    tick: { fill: "#7c8b91", fontSize: 11 },
    axisLine: false,
    tickLine: false,
  };
  const click = (event: any) => {
    if (event?.activeLabel)
      onSelect(
        String(event.activeLabel) < data.start
          ? data.start
          : String(event.activeLabel),
      );
  };
  const tip = (
    <Tooltip
      contentStyle={{
        background: "#182125",
        border: "1px solid #344048",
        borderRadius: 8,
        color: "#fff",
      }}
      labelFormatter={(v) => dateLabel(String(v))}
      formatter={(v: any, name: any) => [
        typeof v === "number" ? v.toFixed(1) : "--",
        name,
      ]}
    />
  );
  return (
    <section
      className={
        "panel chart-panel " + (metric === "strain" ? "wide-chart" : "")
      }
    >
      <div className="panel-heading">
        <h3>
          <span className="chart-dot" style={{ background: color }} />
          {metric === "sleep"
            ? "Sleep performance"
            : metric[0].toUpperCase() + metric.slice(1)}
        </h3>
        <span className="chart-unit">
          {metric === "strain" ? "0 - 21" : "%"}
        </span>
      </div>
      <p className="subtle">
        {metric === "strain"
          ? "Daily effort and your 7-day rolling average"
          : metric === "sleep"
            ? "How much of your sleep need you met"
            : "Your readiness to take on the day"}
      </p>
      <div
        className="chart-container"
        role="img"
        aria-label={`${metric} historical chart; exact values available in the history table`}
      >
        <ResponsiveContainer width="100%" height="100%">
          {metric === "recovery" ? (
            <BarChart
              data={data.chart.points}
              onClick={click}
              margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="#263035"
                strokeDasharray="3 4"
              />
              <XAxis
                dataKey="date"
                tickFormatter={dateLabel}
                minTickGap={35}
                {...axis}
              />
              <YAxis domain={[0, 100]} {...axis} />
              {tip}
              <Bar
                dataKey="recovery"
                name="Recovery %"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              >
                {data.chart.points.map((p) => (
                  <Cell
                    key={p.date}
                    fill={recoveryColor(p.recovery)}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <ComposedChart
              data={data.chart.points}
              onClick={click}
              margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="#263035"
                strokeDasharray="3 4"
              />
              <XAxis
                dataKey="date"
                tickFormatter={dateLabel}
                minTickGap={35}
                {...axis}
              />
              <YAxis
                domain={metric === "strain" ? [0, 21] : [0, 100]}
                {...axis}
              />
              {metric === "sleep" && (
                <YAxis
                  yAxisId="hours"
                  orientation="right"
                  {...axis}
                  width={28}
                />
              )}
              <defs>
                <linearGradient
                  id={"chart-" + metric}
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              {tip}
              <Area
                type="monotone"
                dataKey={metric}
                name={metric === "sleep" ? "Performance %" : "Strain"}
                stroke={color}
                fill={`url(#chart-${metric})`}
                strokeWidth={2}
                isAnimationActive={false}
              />
              {metric === "strain" && (
                <Line
                  dataKey="strainAverage"
                  name="7-day average"
                  type="monotone"
                  stroke="#a4d4ec"
                  strokeDasharray="4 4"
                  dot={false}
                  strokeWidth={1.3}
                  isAnimationActive={false}
                />
              )}{" "}
              {metric === "sleep" && (
                <Line
                  yAxisId="hours"
                  dataKey="hours"
                  name="Hours asleep"
                  stroke="#b6f36b"
                  dot={false}
                  strokeWidth={1.3}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        <span>
          <i style={{ background: color }} />
          {metric === "recovery"
            ? "Recovery zones: low / medium / high"
            : metric === "sleep"
              ? "Sleep performance"
              : "Strain"}
        </span>
        {metric !== "recovery" && (
          <span>
            <i
              style={{ background: metric === "sleep" ? "#b6f36b" : "#a4d4ec" }}
            />
            {metric === "sleep" ? "Hours asleep (right axis)" : "7-day average"}
          </span>
        )}
      </div>
    </section>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-header">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Landing() {
  const d = sample(ago(29), today());
  return (
    <div className="landing">
      <div className="eyebrow">
        <span className="status-dot" />A LONGER VIEW OF YOU
      </div>
      <h1>
        Your history.
        <br />
        More perspective.
      </h1>
      <p className="landing-description">
        Bring your WHOOP strain, sleep, and recovery into one clear view. See
        the patterns behind your performance, from last night to your very first
        day.
      </p>
      <div className="button-row">
        <a href="/auth/whoop" className="button">
          Connect with WHOOP <ArrowRight size={17} />
        </a>
        <a href="/demo" className="button secondary">
          Explore a demo <ArrowUpRight size={17} />
        </a>
      </div>
      <div className="trust-line">
        <ShieldCheck size={15} />
        Private by default
        <span />
        Your complete available history
        <span />
        Always yours to export
      </div>
      <div className="landing-preview">
        <div className="preview-heading">
          <div>
            <span className="eyebrow">A CLEARER PICTURE</span>
            <h2>Small days. Bigger patterns.</h2>
          </div>
          <span className="pill">Illustrative sample</span>
        </div>
        <div className="metrics-grid">
          <MetricCard
            data={d}
            metric="strain"
            label="STRAIN"
            color="#0093e7"
            Icon={Zap}
            unit=" / 21"
          />
          <MetricCard
            data={d}
            metric="sleep"
            label="SLEEP PERFORMANCE"
            color="#7ba1bb"
            Icon={Moon}
            unit="%"
          />
          <MetricCard
            data={d}
            metric="recovery"
            label="RECOVERY"
            color="#16ec06"
            Icon={HeartPulse}
            unit="%"
          />
        </div>
        <Chart
          metric="strain"
          data={d}
          onSelect={() => {
            location.href = "/demo";
          }}
        />
      </div>
      <div className="landing-features">
        <div>
          <CalendarDays />
          <h3>Look beyond this week</h3>
          <p>
            Explore your available history with flexible date ranges and period
            comparisons.
          </p>
        </div>
        <div>
          <HeartPulse />
          <h3>Understand your rhythm</h3>
          <p>
            Connect the dots between daily effort, restorative sleep, and
            recovery.
          </p>
        </div>
        <div>
          <Link2 />
          <h3>Share on your terms</h3>
          <p>
            Keep everything private, or create a public dashboard link you can
            revoke.
          </p>
        </div>
      </div>
      <footer>
        <span>Independent dashboard. Data imported from WHOOP.</span>
        <a href="/privacy">Privacy & your data</a>
      </footer>
    </div>
  );
}
function Privacy() {
  return (
    <article className="privacy">
      <div className="eyebrow">YOUR DATA, YOUR CONTROL</div>
      <h1>Privacy at Gallant</h1>
      <p>
        Gallant is an independent dashboard hosted at whoop.3spinningplates.com.
        Your WHOOP authorization allows it to import your profile, available
        cycles, sleep, recovery, workouts, and current body measurements.
      </p>
      <h2>What we store</h2>
      <p>
        We store imported WHOOP records and encrypted authorization tokens on
        this server. Tokens let the background worker keep your dashboard up to
        date. Your WHOOP password is never collected. Essential cookies keep you
        signed in and protect sign-in requests; there are no advertising
        trackers.
      </p>
      <h2>Private unless you share</h2>
      <p>
        Only your signed-in account can access your dashboard by default. If you
        enable public sharing, anyone with the link can see your name and the
        metrics and date range you select until the link expires or is revoked.
        Existing full-history links retain their scope until you change their
        settings. Public views exclude email, credentials, raw exports, and
        account controls. Turning sharing off invalidates the link immediately;
        it cannot retract copies visitors already made.
      </p>
      <h2>Disconnect, export, or delete</h2>
      <p>
        You can download CSV or JSON exports from your account. Disconnecting
        revokes WHOOP access, stops synchronization, and turns off sharing while
        preserving private imported history. Deleting your account removes its
        active records and sessions. Database backups are retained for 14 days.
        Operational logs exclude credentials and OAuth query parameters.
      </p>
      <h2>Availability and limits</h2>
      <p>
        The dashboard reflects records available through WHOOP's official API.
        It is not a medical service or an official WHOOP product. Public links
        are excluded from indexing requests, but anyone with a link can still
        share it. For account support, contact the operator through{" "}
        <a href="https://christitus.com/contact/">Chris Titus's contact page</a>
        .
      </p>
      <a href="/" className="button secondary">
        Back to Gallant <ArrowRight size={16} />
      </a>
    </article>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
