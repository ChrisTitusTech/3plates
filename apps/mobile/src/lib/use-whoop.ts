import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import type { Dashboard } from '@3plates/whoop/types';
import { loadWhoopDashboard } from './fitness-client';

export function useWhoop(userId: string | undefined, start: string, end: string, revision = 0) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loadedOwner, setLoadedOwner] = useState<string>();
  const [status, setStatus] = useState('Connect WHOOP in Account to add imported data.');
  useFocusEffect(useCallback(() => {
    let active = true; let loading = false;
    setData(null);
    if (!userId) return;
    setStatus('Loading WHOOP history...');
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const result = await loadWhoopDashboard(userId!, start, end);
        if (!active) return;
        setLoadedOwner(userId); setData(result.data);
        setStatus(result.stale ? `Saved WHOOP data from ${new Date(result.savedAt).toLocaleString()}.` : `WHOOP last synchronized: ${result.data.lastSync ? new Date(result.data.lastSync).toLocaleString() : 'initial import in progress'}.`);
      } catch (error) { if (active) setStatus(error instanceof Error ? error.message : 'WHOOP data is unavailable.'); }
      finally { loading = false; }
    }
    void load();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 30000);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void load(); });
    return () => { active = false; clearInterval(timer); listener.remove(); };
  }, [userId, start, end, revision]));
  return { data: loadedOwner === userId ? data : null, status };
}
