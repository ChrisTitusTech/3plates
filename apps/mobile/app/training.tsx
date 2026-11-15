import { useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { calendarDateSchema } from '@3plates/contract';
import { exploreWorkouts } from '@3plates/whoop/explore';
import { Button, Card, Field, FitnessPage, ui } from '../src/components/FitnessUI';
import { WhoopDetail } from '../src/components/WhoopDetail';
import { MetricChart } from '../src/components/MetricChart';
import { useFitness } from '../src/lib/use-fitness';
import { useWhoop } from '../src/lib/use-whoop';
import { entrySummary, localDay } from '../src/lib/log-form';
import { workoutCount } from '../src/lib/workout-history';

export default function TrainingScreen() {
  const { account, snapshot } = useFitness();
  const [start, setStart] = useState(localDay(new Date(Date.now() - 89 * 86400000)));
  const [end, setEnd] = useState(localDay());
  const [range, setRange] = useState({ start, end });
  const [sport, setSport] = useState('');
  const [minMinutes, setMinMinutes] = useState('');
  const [maxMinutes, setMaxMinutes] = useState('');
  const [minStrain, setMinStrain] = useState('');
  const [zone, setZone] = useState('');
  const [zoneMinutes, setZoneMinutes] = useState('');
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const whoop = useWhoop(account?.user.id, range.start, range.end, revision);
  const numeric = (text: string) => text.trim() && Number.isFinite(Number(text)) && Number(text) >= 0 ? Number(text) : undefined;
  const filters = { sport: sport || undefined, minMinutes: numeric(minMinutes), maxMinutes: numeric(maxMinutes),
    minStrain: numeric(minStrain), zone: zone || undefined, minZoneMinutes: numeric(zoneMinutes) };
  const explored = exploreWorkouts(whoop.data?.details ?? [], filters);
  const manual = snapshot.logs.filter((log) => log.entry?.kind === 'workout' && log.entry.date >= range.start && log.entry.date <= range.end);
  const visibleManual = manual.filter((log) => log.entry?.kind === 'workout' && (!sport || log.entry.details.sport === sport)
    && (filters.minMinutes === undefined || log.entry.details.durationMinutes >= filters.minMinutes)
    && (filters.maxMinutes === undefined || log.entry.details.durationMinutes <= filters.maxMinutes));
  const sports = [...new Set([...(whoop.data?.details.filter((d) => d.kind === 'workout').map((d) => d.sport ?? '') ?? []),
    ...manual.map((log) => log.entry?.kind === 'workout' ? log.entry.details.sport : '')])].filter(Boolean).sort();
  return <FitnessPage title="Workouts">
    <View style={ui.row}><Link href="/log" style={ui.heading}>Log a workout</Link><Link href="/workouts" style={ui.heading}>Workout programs</Link>
      <Link href="/progress" style={ui.heading}>Previous workout entries</Link></View>
    <Card title="History range"><View style={ui.row}><Field label="Start (YYYY-MM-DD)" value={start} onChange={setStart} /><Field label="End (YYYY-MM-DD)" value={end} onChange={setEnd} /></View>
      <Button title="Load history" onPress={() => {
        if (!calendarDateSchema.safeParse(start).success || !calendarDateSchema.safeParse(end).success || start > end || Date.parse(end) - Date.parse(start) > 3660 * 86400000) { setError('Choose valid dates up to ten years apart.'); return; }
        setRange({ start, end }); setRevision((value) => value + 1); setLimit(20); setError('');
      }} />{!!error && <Text role="alert" style={ui.notice}>{error}</Text>}
      <Text style={ui.text}>{workoutCount(manual, whoop.data?.details ?? [])} activities in the loaded range, with linked manual/WHOOP records counted once.</Text>
      <Text style={ui.muted}>{whoop.status}</Text>
    </Card>
    <Card title="Explore workouts">
      <View style={ui.row}><Button title="All sports" disabled={!sport} onPress={() => setSport('')} />{sports.map((name) => <Button key={name} title={name} disabled={sport === name} onPress={() => setSport(name)} />)}</View>
      <View style={ui.row}><Field label="Minimum minutes" value={minMinutes} onChange={setMinMinutes} numeric /><Field label="Maximum minutes" value={maxMinutes} onChange={setMaxMinutes} numeric />
        <Field label="Minimum WHOOP strain" value={minStrain} onChange={setMinStrain} numeric /></View>
      <Text style={ui.muted}>WHOOP heart-rate zone</Text><View style={ui.row}><Button title="Any zone" disabled={!zone} onPress={() => setZone('')} />
        {['zero', 'one', 'two', 'three', 'four', 'five'].map((word, n) => <Button key={word} title={`Zone ${n}`} disabled={zone === `zone_${word}_milli`} onPress={() => setZone(`zone_${word}_milli`)} />)}</View>
      <Field label="Minimum zone minutes" value={zoneMinutes} onChange={setZoneMinutes} numeric />
      <MetricChart label="Filtered WHOOP training hours by week" points={explored.weeks.map((week) => ({ label: week.date, value: week.hours }))} />
      <Text style={ui.muted}>Strain and heart-rate filters apply to WHOOP observations. Manual sets and duration remain separate.</Text>
    </Card>
    <Card title={`Manual workouts (${visibleManual.length})`}>
      {visibleManual.slice(0, limit).map((log) => log.entry?.kind === 'workout' && <View key={log.id} style={{ gap: 6 }}>
        <Text style={ui.heading}>{log.entry.date}: {entrySummary(log.entry)}</Text>
        <Text style={ui.muted}>Manual / {log.entry.timezone}{log.entry.details.distanceKm === undefined ? '' : ` / ${log.entry.details.distanceKm.toFixed(2)} km`}</Text>
        {log.entry.details.exercises.map((exercise, i) => <Text key={i} style={ui.text}>{exercise.name}: {exercise.sets.map((set) => `${set.reps} reps x ${Number(set.weightKg.toFixed(2))} kg`).join('; ')}</Text>)}
        {!!log.entry.notes && <Text style={ui.text}>{log.entry.notes}</Text>}
      </View>)}
      {!visibleManual.length && <Text style={ui.muted}>No manual workouts match these filters.</Text>}
      <Link href="/log" style={ui.heading}>Edit entries in Log</Link>
    </Card>
    <Card title={`WHOOP workouts (${explored.rows.length})`}>
      {explored.rows.slice(0, limit).map((detail, index) => <WhoopDetail key={detail.sourceId ?? `${detail.start}-${index}`} detail={detail} />)}
      {!explored.rows.length && <Text style={ui.muted}>No WHOOP workouts match these filters.</Text>}
    </Card>
    {(explored.rows.length > limit || visibleManual.length > limit) && <Button title="Show more workouts" onPress={() => setLimit((n) => n + 20)} />}
  </FitnessPage>;
}
