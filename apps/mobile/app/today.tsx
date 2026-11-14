import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Card, FitnessPage, ui } from '../src/components/FitnessUI';
import { useFitness } from '../src/lib/use-fitness';
import { useWhoop } from '../src/lib/use-whoop';
import { entrySummary, localDay } from '../src/lib/log-form';
import { workoutCount } from '../src/lib/workout-history';

export default function TodayScreen() {
  const { account, snapshot, message, busy, refresh } = useFitness();
  const today = localDay();
  const whoop = useWhoop(account?.user.id, today, today);
  const entries = snapshot.logs.filter((log) => log.entry?.date === today).map((log) => log.entry!);
  const nutrition = entries.filter((entry) => entry.kind === 'nutrition');
  const calories = nutrition.reduce((total, entry) => total + entry.details.calories, 0);
  const protein = nutrition.reduce((total, entry) => total + entry.details.proteinGrams, 0);
  const water = entries.filter((entry) => entry.kind === 'hydration').reduce((total, entry) => total + entry.details.milliliters, 0);
  const workouts = workoutCount(snapshot.logs.filter((log) => log.entry?.date === today), whoop.data?.details ?? []);
  const day = whoop.data?.days[0];
  return <FitnessPage title={account?.user.displayName ? `Today, ${account.user.displayName}` : 'Today'}>
    <Text style={ui.muted}>{today}</Text>
    <Text accessibilityLiveRegion="polite" style={ui.notice}>{message} {snapshot.pending ? `${snapshot.pending} changes waiting to sync.` : ''}</Text>
    <Button title="Refresh and sync" disabled={busy} onPress={() => { void refresh(); }} />
    <Card title="Your day">
      <View style={ui.row}>
        <Text style={ui.text}>{calories.toFixed(0)} kcal logged</Text><Text style={ui.text}>{protein.toFixed(0)} g protein</Text>
        <Text style={ui.text}>{water.toFixed(0)} mL water</Text>
      </View>
      <Text style={ui.text}>{workouts} workouts {whoop.data ? '(linked records counted once)' : 'manually logged'}</Text>
      <Link href="/log" style={ui.heading}>Add a daily entry</Link>
    </Card>
    <Card title="Recovery, sleep, and strain">
      <Text style={ui.muted}>{whoop.status}</Text>
      <Text style={ui.text}>Recovery: {day?.recovery == null ? 'No score' : `${day.recovery.toFixed(0)}%`}</Text>
      <Text style={ui.text}>Sleep performance: {day?.sleep == null ? 'No score' : `${day.sleep.toFixed(0)}%`}</Text>
      <Text style={ui.text}>Strain: {day?.strain == null ? 'No score' : day.strain.toFixed(1)}</Text>
      <Link href="/trends" style={ui.heading}>Explore your history</Link>
    </Card>
    <Card title="Goals">
      {snapshot.logs.filter((log) => log.entry?.kind === 'goal').filter((log, index, all) =>
        all.findIndex((candidate) => candidate.entry?.kind === 'goal' && log.entry?.kind === 'goal' && candidate.entry.details.metric === log.entry.details.metric) === index)
        .map((log) => <Text key={log.id} style={ui.text}>{entrySummary(log.entry!)}</Text>)}
      {!snapshot.logs.some((log) => log.entry?.kind === 'goal') && <Text style={ui.muted}>Add a personal goal from Log.</Text>}
    </Card>
    <Card title="Today's journal">
      {entries.length ? entries.map((entry, index) => <View key={index} style={{ gap: 4 }}><Text style={ui.text}>{entrySummary(entry)}</Text>
        {!!entry.notes && <Text style={ui.muted}>{entry.notes}</Text>}</View>) : <Text style={ui.muted}>Nothing logged yet.</Text>}
    </Card>
    <Link href="/progress" style={ui.muted}>Previous progress and workout history</Link>
  </FitnessPage>;
}
