import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, useColorScheme } from 'react-native';
import type { Preferences } from '@3plates/contract';
import { fetchMe, fetchPreferences, getCachedPreferences, syncPendingPreferences, getSessionGeneration, getSessionToken, subscribePreferences, subscribeSession, updatePreferences } from './api';

export const palettes = {
  light: { ink: '#142b38', muted: '#526975', accent: '#087f73', onAccent: '#ffffff', light: '#edf7f4', border: '#d6e2e6', danger: '#a52c36', onDanger: '#ffffff', background: '#f4f7f9', surface: '#ffffff', strong: '#142b38', onStrong: '#ffffff', success: '#067647' },
  dark: { ink: '#edf5f8', muted: '#b2c4ce', accent: '#65dcc7', onAccent: '#102b26', light: '#193d38', border: '#3c515e', danger: '#ef818b', onDanger: '#3c1018', background: '#0e171f', surface: '#17262f', strong: '#d9e8ed', onStrong: '#142b38', success: '#72d8a7' },
};
export type ThemeColors = typeof palettes.light;
type Mode = Preferences['theme'];
type ThemeState = { colors: ThemeColors; mode: Mode; resolved: 'light' | 'dark'; busy: boolean; available: boolean; message: string; choose(mode: Mode): Promise<void>; retry(): void };
const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const system = useColorScheme();
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const revision = useRef(0);
  const mounted = useRef(true);
  const ownerValidated = useRef(true);
  async function load(hydrate = true) {
    const current = ++revision.current;
    const active = () => mounted.current && revision.current === current;
    setBusy(true);
    try {
      if (!await getSessionToken()) { if (active()) setPreferences(null); return; }
      if (hydrate && ownerValidated.current) {
        const cached = await getCachedPreferences();
        if (active() && cached) { setPreferences(cached); setBusy(false); }
      }
      const account = await fetchMe();
      if (!active()) return;
      if (!ownerValidated.current && account.source !== 'network') {
        setMessage('Connect to verify this account before loading its appearance.');
        return;
      }
      ownerValidated.current = true;
      // Offline queues remain authoritative until a later connection can flush them.
      await syncPendingPreferences().catch(() => undefined);
      if (!active()) return;
      const result = await fetchPreferences();
      if (active()) { setPreferences(result.data); setMessage(''); }
    } catch { if (active()) setMessage('Appearance settings are unavailable. Retry when connected.'); }
    finally { if (active()) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    // A new session must prove its owner before using the previous account cache.
    const session = subscribeSession(() => { ownerValidated.current = false; revision.current++; setPreferences(null); setMessage(''); void load(false); });
    const changes = subscribePreferences((value) => { revision.current++; setPreferences(value); setBusy(false); });
    const foreground = AppState.addEventListener('change', (state) => { if (state === 'active') void load(); });
    const online = () => { void load(); };
    // Native connectivity may recover without an AppState change. Retry only
    // queued preferences while active; an empty queue performs no network call.
    const retryPending = setInterval(() => {
      if (ownerValidated.current && AppState.currentState === 'active') void syncPendingPreferences().catch(() => undefined);
    }, 30000);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('online', online);
    void load();
    return () => {
      mounted.current = false; revision.current++; session(); changes(); foreground.remove(); clearInterval(retryPending);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('online', online);
    };
  }, []);
  async function choose(mode: Mode) {
    if (!preferences || busy) return;
    const session = getSessionGeneration();
    setBusy(true); setMessage('');
    try {
      const result = await updatePreferences({ ...preferences, theme: mode });
      // The preference event applies the saved value; session changes invalidate this operation.
      if (mounted.current && getSessionGeneration() === session) setMessage(result.queued ? 'Appearance saved on this device. It will sync when connected.' : '');
    } catch { if (mounted.current && getSessionGeneration() === session) setMessage('Could not save appearance. Please retry.'); }
    finally { if (mounted.current && getSessionGeneration() === session) setBusy(false); }
  }
  const mode = preferences?.theme ?? 'system';
  const resolved = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.documentElement.style.colorScheme;
    document.documentElement.style.colorScheme = resolved;
    return () => { document.documentElement.style.colorScheme = previous; };
  }, [resolved]);
  return <ThemeContext.Provider value={{ colors: palettes[resolved], mode, resolved, busy, available: !!preferences, message, choose, retry: () => { void load(); } }}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('ThemeProvider is required.');
  return value;
}
