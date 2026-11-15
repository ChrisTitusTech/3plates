import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { clearLogDraft, readLogDraft, writeLogDraft, type LogDraft } from './log-draft';
import { newLogForm } from './log-form';

const draft = (title: string): LogDraft => ({ kind: 'workout', form: { ...newLogForm(), title }, exercises: [{ name: 'Squat', sets: [{ reps: '5', weight: '100' }] }], imperial: false });
function storage(t: TestContext) {
  const values = new Map<string, string>(); let fail = false;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (fail) throw new Error('Quota exceeded'); values.set(key, value); },
    removeItem: (key: string) => { if (fail) throw new Error('Storage unavailable'); values.delete(key); },
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else Reflect.deleteProperty(globalThis, 'sessionStorage'); });
  return { values, fail: () => { fail = true; } };
}

test('in-process draft writes and clears override stale storage after storage failure', (t) => {
  const s = storage(t); writeLogDraft('failed-storage', draft('Old'));
  s.fail(); writeLogDraft('failed-storage', draft('Latest'));
  assert.equal(readLogDraft('failed-storage')?.form.title, 'Latest');
  clearLogDraft('failed-storage'); assert.equal(readLogDraft('failed-storage'), undefined);
  assert.equal(JSON.parse(s.values.get('@3plates/log-draft/failed-storage')!).form.title, 'Old');
});

test('stored draft restoration validates form, exercises, units and edit metadata', (t) => {
  const s = storage(t); const valid = draft('Restored');
  const invalid = [null, [], { ...valid, exercises: {} }, { ...valid, form: {} }, { ...valid, imperial: 'false' },
    { ...valid, kind: 'unsupported' }, { ...valid, exercises: [{ name: 'Squat', sets: [{ reps: 5, weight: '100' }] }] },
    { ...valid, editing: '00000000-0000-4000-8000-000000000001' }];
  invalid.forEach((value, index) => {
    s.values.set(`@3plates/log-draft/invalid-${index}`, JSON.stringify(value));
    assert.equal(readLogDraft(`invalid-${index}`), undefined);
  });
  const edited = { ...valid, editing: '00000000-0000-4000-8000-000000000001', editingVersion: 2 };
  s.values.set('@3plates/log-draft/valid', JSON.stringify(edited));
  assert.deepEqual(readLogDraft('valid'), edited);
});
