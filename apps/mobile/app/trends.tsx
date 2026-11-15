import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { calendarDateSchema } from '@3plates/contract';
import { aggregateAnalytics, calendarYear } from '@3plates/whoop/analytics';
import { compareYears, correlations, type Metric } from '@3plates/whoop/explore';
import { Button, Card, Field, FitnessPage, useFitnessStyles } from '../src/components/FitnessUI';
import { MetricChart } from '../src/components/MetricChart';
import { WhoopDetail } from '../src/components/WhoopDetail';
import { useFitness } from '../src/lib/use-fitness';
import { useWhoop } from '../src/lib/use-whoop';
import { entrySummary, localDay } from '../src/lib/log-form';

const metrics: Metric[] = ['strain', 'sleep', 'recovery', 'hours', 'hrv', 'rhr'];
const labels: Record<Metric, string> = { strain: 'Strain', sleep: 'Sleep performance (%)', recovery: 'Recovery (%)', hours: 'Sleep (hours)', hrv: 'HRV (ms)', rhr: 'Resting heart rate (bpm)' };
const value = (n: number | null | undefined) => n == null ? 'Unavailable' : n.toFixed(1);
export default function TrendsScreen() {
  const { ui, colors } = useFitnessStyles();
  const { account, snapshot } = useFitness();
  const [start, setStart] = useState(localDay(new Date(Date.now() - 29 * 86400000)));
  const [end, setEnd] = useState(localDay());
  const [range, setRange] = useState({ start, end });
  const [error, setError] = useState('');
  const [metric, setMetric] = useState<Metric>('recovery');
  const [xMetric, setXMetric] = useState<Metric>('hours');
  const [lag, setLag] = useState<0 | 1>(1);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [otherYear, setOtherYear] = useState(String(new Date().getFullYear() - 1));
  const [selectedDay, setSelectedDay] = useState(localDay());
  const [detailLimit, setDetailLimit] = useState(15);
  const [revision, setRevision] = useState(0);
  const whoop = useWhoop(account?.user.id, range.start, range.end, revision);
  const data = whoop.data;
  const overviewChart = data ? aggregateAnalytics(data.days) : null;
  const sleepChart = data ? aggregateAnalytics(data.analytics.sleep) : null;
  const recoveryChart = data ? aggregateAnalytics(data.analytics.recovery) : null;
  const chartValue = (point: Record<string, string | number | null>, key: string) => typeof point[key] === 'number' ? point[key] as number : null;
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 2100;
  const comparison = data && validYear && /^\d{4}$/.test(otherYear) ? compareYears(data.exploration, Number(year), Number(otherYear), metric) : [];
  const correlation = data ? correlations(data.exploration.filter((d) => d.date >= range.start && d.date <= range.end), xMetric, metric, lag) : null;
  const manual = snapshot.logs.filter((log) => log.entry && log.entry.date >= range.start && log.entry.date <= range.end);
  const weights = manual.filter((log) => log.entry?.kind === 'weight').reverse();
  function applyRange() {
    if (!calendarDateSchema.safeParse(start).success || !calendarDateSchema.safeParse(end).success || start > end || Date.parse(end) - Date.parse(start) > 3660 * 86400000) {
      setError('Choose valid dates in order, up to ten years apart.'); return;
    }
    setError(''); setRange({ start, end }); setDetailLimit(15); setRevision((n) => n + 1);
  }
  return <FitnessPage title="Trends">
    <Card title="Date range"><View style={ui.row}><Field label="Start (YYYY-MM-DD)" value={start} onChange={setStart} />
      <Field label="End (YYYY-MM-DD)" value={end} onChange={setEnd} /></View>
      <Button title="Apply dates and refresh" onPress={applyRange} />{!!error && <Text role="alert" style={ui.notice}>{error}</Text>}
    </Card>
    <Card title="Manual history">
      <Text style={ui.muted}>{manual.length} entries in this range. Manual observations are kept separate from WHOOP scores.</Text>
      <MetricChart label="Body weight (kg)" points={weights.map((log) => ({ label: log.entry!.date, value: log.entry?.kind === 'weight' ? log.entry.details.kilograms : null }))} />
      {manual.filter((log) => log.entry?.kind === 'recovery' || log.entry?.kind === 'sleep').slice(0, 10).map((log) =>
        <Text key={log.id} style={ui.text}>{log.entry!.date}: {entrySummary(log.entry!)} {log.entry!.notes}</Text>)}
    </Card>
    <Text style={ui.notice}>{whoop.status}</Text>
    {data && <>
      <Card title="WHOOP overview">
        <View style={ui.row}>{metrics.map((key) => <Button key={key} title={labels[key]} disabled={key === metric} onPress={() => setMetric(key)} />)}</View>
        <Text style={ui.text}>Average {labels[metric]}: {value(data.summary[metric]?.value)} ({data.summary[metric]?.count ?? 0} observations).</Text>
        <Text style={ui.muted}>Previous period ({data.previousStart} - {data.previousEnd}): {value(data.previous[metric]?.value)} ({data.previous[metric]?.count ?? 0} observations).</Text>
        <Text style={ui.muted}>Chart averages by {overviewChart?.mode}; missing observations are excluded.</Text>
        <MetricChart label={labels[metric]} points={overviewChart!.points.map((day) => ({ label: String(day.date), value: chartValue(day, metric) }))} />
      </Card>
      <Card title="Sleep details">
        {(['hours', 'need', 'debt', 'light', 'deep', 'rem', 'napHours', 'efficiency', 'consistency', 'bedtime', 'wake'] as const).map((key) =>
          <MetricChart key={key} label={key === 'efficiency' || key === 'consistency' ? `${key} (%)` : `${key} (hours)`}
            points={sleepChart!.points.map((day) => ({ label: String(day.date), value: chartValue(day, key) }))} />)}
      </Card>
      <Card title="Recovery baseline">
        {(['hrv', 'hrvBaseline', 'rhr', 'rhrBaseline'] as const).map((key) => <MetricChart key={key}
          label={`${key.startsWith('hrv') ? 'HRV (ms)' : 'Resting heart rate (bpm)'}${key.endsWith('Baseline') ? ' - preceding 28 days' : ''}`}
          points={recoveryChart!.points.map((day) => ({ label: String(day.date), value: chartValue(day, key) }))} />)}
        <Text style={ui.muted}>Baselines require at least seven readings in the preceding 28 days.</Text>
      </Card>
      <Card title="Recovery calendar">
        <Field label="Calendar year" value={year} onChange={setYear} numeric />
        <View style={ui.row}>{validYear && calendarYear(data.analytics.calendar, Number(year)).map((day) => <Pressable key={day.date}
          accessibilityRole="button" accessibilityLabel={`${day.date}: recovery ${value(day.recovery)}; sleep ${value(day.sleep)}; strain ${value(day.strain)}`}
          onPress={() => setSelectedDay(day.date)} style={{ width: 28, height: 28, borderRadius: 4, borderWidth: day.date === selectedDay ? 3 : 0, borderColor: colors.ink,
            backgroundColor: day.recovery === null ? colors.border : day.recovery >= 67 ? '#188a62' : day.recovery >= 34 ? '#d5aa27' : '#be3f4b' }} />)}</View>
        <Text style={ui.muted}>Green: 67-100; yellow: 34-66; red: below 34; gray: no score. Select a day to inspect it.</Text>
        <Text style={ui.text}>{selectedDay}: {(() => { const day = data.analytics.calendar.find((d) => d.date === selectedDay); return `recovery ${value(day?.recovery)}, sleep ${value(day?.sleep)}, strain ${value(day?.strain)}`; })()}</Text>
        {data.completeness?.filter((day) => day.date === selectedDay).map((day) => <Text key={day.date} style={ui.muted}>Cycle {day.cycle}; sleep {day.sleep}; recovery {day.recovery}.</Text>)}
        <Button title="Inspect this day's records" onPress={() => { setStart(selectedDay); setEnd(selectedDay); setRange({ start: selectedDay, end: selectedDay }); }} />
      </Card>
      <Card title="Correlations">
        <Text style={ui.muted}>Input metric (X). Outcome (Y): {labels[metric]}, selected above. Association does not establish cause.</Text>
        <View style={ui.row}>{metrics.map((key) => <Button key={key} title={labels[key]} disabled={key === xMetric} onPress={() => setXMetric(key)} />)}</View>
        <Button title={lag ? 'Outcome: following day' : 'Outcome: same day'} onPress={() => setLag(lag ? 0 : 1)} />
        {correlation && <><MetricChart label={`${labels[xMetric]} vs ${labels[metric]}`} scatter points={correlation.points.map((point) => ({ label: point.date, x: point.x, value: point.y }))} />
          <Text style={ui.text}>{correlation.count} matched days. Pearson r: {correlation.r === null ? 'Unavailable (at least ten varied pairs required)' : correlation.r.toFixed(3)}.</Text></>}
      </Card>
      <Card title="Year comparison">
        <Field label="Compare calendar year with" value={otherYear} onChange={setOtherYear} numeric />
        <Text style={ui.muted}>Same month/day pairs with data in both years, across all imported history.</Text>
        <MetricChart label={`${year}: ${labels[metric]}`} points={comparison.map((month) => ({ label: month.month, value: month.a }))} />
        <MetricChart label={`${otherYear}: ${labels[metric]}`} points={comparison.map((month) => ({ label: month.month, value: month.b }))} />
        {comparison.map((month) => <Text key={month.month} style={ui.muted}>Month {month.month}: {value(month.a)} / {value(month.b)} ({month.count} matched days)</Text>)}
      </Card>
      <Card title="Lifetime">
        <Text style={ui.text}>{data.lifetime.firstDate ?? 'No history'} - {data.lifetime.lastDate ?? 'No history'}; {data.lifetime.daysRecorded} recorded days; {data.lifetime.greenRecoveryDays} green recoveries.</Text>
        <Text style={ui.text}>{data.lifetime.workouts} workouts; {value(data.lifetime.workoutHours)} hours across {data.lifetime.timedWorkouts} timed workouts.</Text>
        <Text style={ui.text}>{value(data.lifetime.sleepHours)} sleep hours across {data.lifetime.nights} nights; {value(data.lifetime.napHours)} nap hours.</Text>
        {Object.entries(data.lifetime.metrics).map(([key, stats]) => <View key={key}><Text style={ui.text}>{labels[key as Metric]}: {value(stats.average)} average ({stats.count} days)</Text>
          <Text style={ui.muted}>High {value(stats.highest?.value)} on {stats.highest?.date ?? '-'}; low {value(stats.lowest?.value)} on {stats.lowest?.date ?? '-'}</Text></View>)}
      </Card>
      {data.body && <Card title="Latest WHOOP body measurements"><WhoopDetail detail={data.body} /></Card>}
      <Card title="Source records">
        <Text style={ui.muted}>WHOOP measurements in their original units. Milliseconds are labeled milli; missing and pending scores are preserved.</Text>
        {data.details.slice(0, detailLimit).map((detail, index) => <WhoopDetail key={`${detail.kind}-${detail.start}-${index}`} detail={detail} />)}
        {data.details.length > detailLimit && <Button title="Show more source records" onPress={() => setDetailLimit((n) => n + 25)} />}
      </Card>
    </>}
  </FitnessPage>;
}
