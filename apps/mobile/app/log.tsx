import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { calendarDateSchema, type HealthLog } from '@3plates/contract';
import { Button, Card, Field, FitnessPage, useFitnessStyles } from '../src/components/FitnessUI';
import { useFitness } from '../src/lib/use-fitness';
import { fetchPreferences } from '../src/lib/api';
import { fitnessRequest } from '../src/lib/fitness-client';
import { entryForm, entrySummary, formEntry, logKinds, newLogForm, type ExerciseForm, type LogKind } from '../src/lib/log-form';

export default function LogScreen() {
  const { ui } = useFitnessStyles();
  const fitness = useFitness();
  if (!fitness.account) return <FitnessPage title="Daily log"><Text style={ui.notice}>{fitness.message}</Text></FitnessPage>;
  return <LogFormScreen key={fitness.account.user.id} fitness={fitness} />;
}
function LogFormScreen({ fitness }: { fitness: ReturnType<typeof useFitness> }) {
  const { ui, colors } = useFitnessStyles();
  const { account, snapshot, message, busy, refresh, setMessage } = fitness;
  const [kind, setKind] = useState<LogKind>('workout');
  const draftRevision = useRef(0);
  const [form, writeForm] = useState(newLogForm);
  const [exercises, writeExercises] = useState<ExerciseForm[]>([]);
  const setForm: typeof writeForm = (value) => { draftRevision.current++; writeForm(value); };
  const setExercises: typeof writeExercises = (value) => { draftRevision.current++; writeExercises(value); };
  const [editing, setEditing] = useState<string | undefined>();
  const [editingVersion, setEditingVersion] = useState<number | undefined>();
  const editingTarget = useRef<{ id: string; version: number } | null>(null);
  const [imperial, setImperial] = useState(false);
  const [unitsReady, setUnitsReady] = useState(false);
  const [unitNotice, setUnitNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; version: number } | null>(null);
  const [confirmConflict, setConfirmConflict] = useState<string | null>(null);
  const [choices, setChoices] = useState<Array<{ id: string; label: string }>>([]);
  const [visible, setVisible] = useState(20);
  useEffect(() => {
    let active = true;
    void fetchPreferences().then((result) => {
      if (active) setImperial(result.data.units === 'imperial');
    }).catch(() => {
      if (active) setUnitNotice('Using metric units because your preferences are unavailable.');
    }).finally(() => { if (active) setUnitsReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true; setChoices([]);
    if (calendarDateSchema.safeParse(form.date).success) {
      void fitnessRequest<{ workouts: typeof choices }>(`/users/me/whoop/workouts?date=${form.date}`, 'GET', undefined, account?.user.id)
        .then((result) => { if (active) setChoices(result.workouts); }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [account?.user.id, form.date]);
  const field = (key: string, label: string, numeric = false, multiline = false) => <Field key={key}
    label={label} value={form[key] ?? ''} numeric={numeric} multiline={multiline}
    onChange={(value) => setForm((current) => ({ ...current, [key]: value }))} />;
  function edit(record: HealthLog) {
    if (!record.entry) return;
    const loaded = entryForm(record.entry, imperial);
    editingTarget.current = { id: record.id, version: record.version };
    setKind(record.entry.kind); setForm(loaded.form); setExercises(loaded.exercises); setEditing(record.id); setEditingVersion(record.version);
    setMessage('Editing the selected entry in the form above.');
  }
  function reset() { editingTarget.current = null; setEditing(undefined); setEditingVersion(undefined); setForm(newLogForm()); setExercises([]); }
  async function save() {
    if (!account) return;
    const revision = draftRevision.current;
    setSaving(true);
    try {
      await account.engine.save(formEntry(kind, form, exercises, imperial), editing, editingVersion);
      if (draftRevision.current === revision) reset();
      else if (editing && editingVersion !== undefined && editingTarget.current?.id === editing && editingTarget.current.version === editingVersion) {
        // This save advanced the same entry being edited. Preserve newer typing
        // while still rejecting any additional updates from another device.
        editingTarget.current = { id: editing, version: editingVersion + 1 };
        setEditingVersion(editingVersion + 1);
      }
      await refresh(false); setMessage('Saved on this device. Synchronizing...'); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save.'); }
    finally { setSaving(false); }
  }
  function changeExercise(index: number, update: Partial<ExerciseForm>) {
    setExercises((current) => current.map((exercise, i) => i === index ? { ...exercise, ...update } : exercise));
  }
  if (!unitsReady) return <FitnessPage title="Daily log"><Text style={ui.notice}>Loading your measurement units...</Text></FitnessPage>;
  return <FitnessPage title="Daily log">
    {!!unitNotice && <Text style={ui.notice}>{unitNotice}</Text>}
    <Text accessibilityLiveRegion="polite" style={ui.notice}>{message} {snapshot.pending ? `${snapshot.pending} pending changes.` : ''}</Text>
    <Button title="Sync now" disabled={busy || saving} onPress={() => { void refresh(); }} />
    {snapshot.conflicts.map((conflict) => <Card key={conflict.mutation.mutationId} title="Entry needs attention">
      <Text style={ui.text}>{conflict.error}</Text>
      <Text style={ui.muted}>Your local version is kept below. Loading the server version discards pending edits for this entry.</Text>
      <Button title={confirmConflict === conflict.mutation.id ? 'Confirm: discard local edits and load server version' : 'Use server version'} danger
        onPress={() => {
          if (confirmConflict !== conflict.mutation.id) { setConfirmConflict(conflict.mutation.id); return; }
          void account?.engine.acceptServer(conflict.mutation.id).then(() => refresh(false)).catch((error) => setMessage(error.message));
        }} />
    </Card>)}
    <Card title={editing ? 'Edit entry' : 'Add an entry'}>
      <View style={ui.row}>{logKinds.map((value) => <Button key={value} title={(kind === value ? 'Selected: ' : '') + value}
        disabled={!!editing || saving} onPress={() => { setKind(value); reset(); }} />)}</View>
      {field('date', 'Date (YYYY-MM-DD)')}
      {field('timezone', 'Time zone')}
      {kind === 'workout' && <>
        {field('title', 'Workout title')}{field('sport', 'Sport or activity')}
        {field('durationMinutes', 'Duration (minutes)', true)}{field('distance', `Distance (${imperial ? 'miles' : 'km'}, optional)`, true)}
        {exercises.map((exercise, index) => <Card key={index} title={`Exercise ${index + 1}`}>
          <Field label={`Exercise ${index + 1} name`} value={exercise.name} onChange={(name) => changeExercise(index, { name })} />
          {exercise.sets.map((set, setIndex) => <View style={ui.row} key={setIndex}>
            {(['reps', 'weight'] as const).map((key) => <Field key={key} numeric
              label={`Exercise ${index + 1}, set ${setIndex + 1}: ${key === 'reps' ? 'reps' : `weight (${imperial ? 'lb' : 'kg'})`}`}
              value={set[key]} onChange={(value) => changeExercise(index, { sets: exercise.sets.map((candidate, i) => i === setIndex ? { ...candidate, [key]: value } : candidate) })} />)}
            <Button title={`Remove set ${setIndex + 1}`} disabled={exercise.sets.length === 1} onPress={() => changeExercise(index, { sets: exercise.sets.filter((_, i) => i !== setIndex) })} />
          </View>)}
          <Button title="Add set" onPress={() => changeExercise(index, { sets: [...exercise.sets, { reps: '', weight: '0' }] })} />
          <Button title={`Remove exercise ${index + 1}`} danger onPress={() => setExercises((current) => current.filter((_, i) => i !== index))} />
        </Card>)}
        <Button title="Add exercise" onPress={() => setExercises((current) => [...current, { name: '', sets: [{ reps: '', weight: '0' }] }])} />
        <Text style={ui.text}>Associate with a WHOOP workout to avoid counting it twice.</Text>
        <Button title={form.linkedWhoopWorkoutId ? 'Remove WHOOP association' : 'No WHOOP association'} onPress={() => setForm((current) => ({ ...current, linkedWhoopWorkoutId: '' }))} />
        {choices.map((choice) => <Button key={choice.id} title={(form.linkedWhoopWorkoutId === choice.id ? 'Linked: ' : 'Link: ') + choice.label}
          onPress={() => setForm((current) => ({ ...current, linkedWhoopWorkoutId: choice.id }))} />)}
      </>}
      {kind === 'nutrition' && <>{field('meal', 'Meal or food')}{field('calories', 'Calories (kcal)', true)}
        {field('proteinGrams', 'Protein (g)', true)}{field('carbohydrateGrams', 'Carbohydrates (g)', true)}{field('fatGrams', 'Fat (g)', true)}</>}
      {kind === 'hydration' && field('amount', `Water (${imperial ? 'US fl oz' : 'mL'})`, true)}
      {kind === 'weight' && field('weight', `Body weight (${imperial ? 'lb' : 'kg'})`, true)}
      {kind === 'sleep' && <>
        {field('startDate', 'Sleep start date (YYYY-MM-DD)')}{field('startTime', 'Sleep start time (HH:mm)')}{field('startOffset', 'Start UTC offset (for example -06:00)')}
        {field('endDate', 'Wake date (YYYY-MM-DD)')}{field('endTime', 'Wake time (HH:mm)')}{field('endOffset', 'Wake UTC offset (for example -06:00)')}
        <Button title={form.nap === 'yes' ? 'Nap: yes' : 'Nap: no'} onPress={() => setForm((current) => ({ ...current, nap: current.nap === 'yes' ? 'no' : 'yes' }))} />
        {field('quality', 'Sleep quality (1 low, 10 high)', true)}
      </>}
      {kind === 'recovery' && <>{['energy', 'soreness', 'stress', 'mood'].map((key) => field(key, `${key} (1 low, 10 high)`, true))}{field('tags', 'Tags (comma separated)')}</>}
      {kind === 'goal' && <><View style={ui.row}>{['workouts_per_week', 'hydration_ml', 'calories', 'protein_grams', 'weight_kg'].map((metric) => <Button key={metric}
        title={(form.metric === metric ? 'Selected: ' : '') + metric.replaceAll('_', ' ')} onPress={() => setForm((current) => ({ ...current, metric }))} />)}</View>{field('target', 'Target in the selected units', true)}</>}
      {field('notes', 'Notes (optional)', false, true)}
      <Button title={saving ? 'Saving...' : editing ? 'Save changes' : 'Save entry'} disabled={!account || saving} onPress={() => { void save(); }} />
      {editing && <Button title="Cancel editing" onPress={reset} />}
    </Card>
    <Card title="Your entries">
      {!snapshot.logs.length && <Text style={ui.muted}>No entries yet. Your first log can be saved even while offline after signing in.</Text>}
      {snapshot.logs.slice(0, visible).map((record) => <View key={record.id} style={{ gap: 8, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 12 }}>
        <Text style={ui.heading}>{record.entry!.date} / {record.entry!.kind}</Text>
        <Text style={ui.text}>{entrySummary(record.entry!)}</Text>
        {!!record.entry!.notes && <Text style={ui.muted}>{record.entry!.notes}</Text>}
        <View style={ui.row}><Button title={`Edit ${record.entry!.kind} entry`} onPress={() => edit(record)} />
          <Button title={confirmDelete?.id === record.id ? 'Confirm delete entry' : 'Delete entry'} danger onPress={() => {
            if (confirmDelete?.id !== record.id) { setConfirmDelete({ id: record.id, version: record.version }); return; }
            void account?.engine.remove(record.id, confirmDelete.version).then(() => refresh()).catch((error) => { setConfirmDelete(null); setMessage(error.message); });
          }} /></View>
      </View>)}
      {snapshot.logs.length > visible && <Button title="Show more entries" onPress={() => setVisible((count) => count + 20)} />}
    </Card>
  </FitnessPage>;
}
