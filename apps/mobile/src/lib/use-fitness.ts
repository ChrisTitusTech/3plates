import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { AppState } from 'react-native';
import type { User } from '@3plates/contract';
import { currentFitnessAccount } from './fitness-client';
import { clearSession, getSessionGeneration, getSessionToken, subscribeSession } from './api';
import { SyncFailure, type HealthSync } from './health-sync';

export function useFitness() {
  const router = useRouter();
  const focused = useRef(false);
  const running = useRef(false);
  const [account, setAccount] = useState<{ user: User; engine: HealthSync } | null>(null);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<HealthSync['snapshot']>>>({ logs: [], pending: 0, conflicts: [] });
  const [message, setMessage] = useState('Loading your account...');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async (sync = true): Promise<void> => {
    if (running.current) return;
    running.current = true; setBusy(true);
    const generation = getSessionGeneration();
    const current = () => focused.current && generation === getSessionGeneration();
    try {
      const active = await currentFitnessAccount();
      if (!current()) return;
      const local = await active.engine.snapshot();
      if (!current()) return;
      setAccount(active); setSnapshot(local);
      if (sync) {
        try { await active.engine.synchronize(); if (current()) setMessage('Up to date.'); }
        catch (error) {
          if (error instanceof SyncFailure && error.status === 401) throw error;
          if (current()) setMessage('Showing saved entries. Pending changes stay on this device until synchronization succeeds.');
        }
        const next = await active.engine.snapshot();
        if (current()) setSnapshot(next);
      }
    } catch (error) {
      if (!current()) return;
      if ([401, 404].includes((error as { status?: number }).status ?? 0)) {
        // Keep the per-user health queue for reauthentication, but remove the
        // invalid session so Sign In cannot bounce back into this screen.
        await clearSession();
        if (focused.current) { setAccount(null); setSnapshot({ logs: [], pending: 0, conflicts: [] }); router.replace('/sign-in'); }
      }
      if (focused.current) setMessage(error instanceof Error ? error.message : 'Unable to load your account.');
    } finally {
      running.current = false;
      if (focused.current) setBusy(false);
      if (generation !== getSessionGeneration() && focused.current) {
        void getSessionToken().then((token) => { if (token && focused.current) void refresh(); }).catch(() => undefined);
      }
    }
  }, [router]);
  useEffect(() => subscribeSession(() => {
    setAccount(null); setSnapshot({ logs: [], pending: 0, conflicts: [] });
    if (focused.current) void refresh();
  }), [refresh]);
  useFocusEffect(useCallback(() => {
    focused.current = true; void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 30000);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => { focused.current = false; clearInterval(timer); listener.remove(); };
  }, [refresh]));
  return { account, snapshot, message, busy, refresh, setMessage };
}
