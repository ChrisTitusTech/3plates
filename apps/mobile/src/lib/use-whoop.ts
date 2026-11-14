import { useEffect, useState } from 'react';
import type { Dashboard } from '@3plates/whoop/types';
import { loadWhoopDashboard } from './fitness-client';

export function useWhoop(userId: string | undefined, start: string, end: string, revision = 0) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [status, setStatus] = useState('Connect WHOOP in Account to add imported data.');
  useEffect(() => {
    let active = true;
    setData(null);
    if (!userId) return;
    setStatus('Loading WHOOP history...');
    loadWhoopDashboard(userId, start, end).then((result) => {
      if (!active) return;
      setData(result.data);
      setStatus(result.stale ? `Saved WHOOP data from ${new Date(result.savedAt).toLocaleString()}.` : `WHOOP last synchronized: ${result.data.lastSync ? new Date(result.data.lastSync).toLocaleString() : 'initial import in progress'}.`);
    }).catch((error) => { if (active) setStatus(error instanceof Error ? error.message : 'WHOOP data is unavailable.'); });
    return () => { active = false; };
  }, [userId, start, end, revision]);
  return { data, status };
}
