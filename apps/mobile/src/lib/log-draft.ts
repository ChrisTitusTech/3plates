import { z } from 'zod';
import { logKinds, newLogForm, type ExerciseForm, type LogForm, type LogKind } from './log-form';

export type LogDraft = {
  kind: LogKind; form: LogForm; exercises: ExerciseForm[]; imperial: boolean;
  editing?: string; editingVersion?: number;
};
const draftSchema = z.object({
  kind: z.enum(logKinds),
  form: z.record(z.string(), z.string()).refine((form) => Object.keys(newLogForm()).every((field) => typeof form[field] === 'string')),
  exercises: z.array(z.object({ name: z.string(), sets: z.array(z.object({
    reps: z.string(), weight: z.string(), originalWeight: z.string().optional(),
    originalWeightKg: z.number().finite().optional(), originalImperial: z.boolean().optional(),
  })) })),
  imperial: z.boolean(), editing: z.string().uuid().optional(), editingVersion: z.number().int().positive().optional(),
}).refine((draft) => (draft.editing === undefined) === (draft.editingVersion === undefined));
// Keep drafts through credential expiry. The caller must validate the active
// account before reading. Web session storage also survives the OAuth redirect;
// native drafts live only for the current app process.
const drafts = new Map<string, LogDraft | undefined>();
const key = (owner: string) => `@3plates/log-draft/${owner}`;
export function readLogDraft(owner: string): LogDraft | undefined {
  if (drafts.has(owner)) return drafts.get(owner);
  try {
    const saved = globalThis.sessionStorage?.getItem(key(owner));
    if (saved) {
      const parsed = draftSchema.safeParse(JSON.parse(saved));
      const draft = parsed.success ? parsed.data : undefined;
      drafts.set(owner, draft);
      return draft;
    }
  } catch { /* Unavailable browser storage falls back to this process. */ }
  return drafts.get(owner);
}
export function writeLogDraft(owner: string, draft: LogDraft) {
  drafts.set(owner, draft);
  try { globalThis.sessionStorage?.setItem(key(owner), JSON.stringify(draft)); } catch { /* Keep the in-memory draft. */ }
}
export function clearLogDraft(owner: string) {
  // A tombstone prevents stale browser storage from restoring a cleared draft
  // when storage removal fails in this process.
  drafts.set(owner, undefined);
  try { globalThis.sessionStorage?.removeItem(key(owner)); } catch { /* Storage may be unavailable. */ }
}
