import type { ExerciseForm, LogForm, LogKind } from './log-form';

export type LogDraft = {
  kind: LogKind; form: LogForm; exercises: ExerciseForm[]; imperial: boolean;
  editing?: string; editingVersion?: number;
};
// Keep drafts through credential expiry. The caller must validate the active
// account before reading. Web session storage also survives the OAuth redirect;
// native drafts live only for the current app process.
const drafts = new Map<string, LogDraft>();
const key = (owner: string) => `@3plates/log-draft/${owner}`;
export function readLogDraft(owner: string): LogDraft | undefined {
  try {
    const saved = globalThis.sessionStorage?.getItem(key(owner));
    if (saved) return JSON.parse(saved) as LogDraft;
  } catch { /* Unavailable browser storage falls back to this process. */ }
  return drafts.get(owner);
}
export function writeLogDraft(owner: string, draft: LogDraft) {
  drafts.set(owner, draft);
  try { globalThis.sessionStorage?.setItem(key(owner), JSON.stringify(draft)); } catch { /* Keep the in-memory draft. */ }
}
export function clearLogDraft(owner: string) {
  drafts.delete(owner);
  try { globalThis.sessionStorage?.removeItem(key(owner)); } catch { /* Storage may be unavailable. */ }
}
