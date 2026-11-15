import { useEffect, useRef, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import * as ExpoLinking from 'expo-linking';
import { Linking, Text, View } from 'react-native';
import { calendarDateSchema, type AuthProvider } from '@3plates/contract';
import type { Member, Sync } from '@3plates/whoop/types';
import { Button, Card, Field, FitnessPage, useFitnessStyles } from '../src/components/FitnessUI';
import { useFitness } from '../src/lib/use-fitness';
import { apiBaseUrl, clearSession, getSessionGeneration, signOutAndClearSession, startAuthLink } from '../src/lib/api';
import { clearFitnessCache, clearWhoopCache, exportFitnessFile, fitnessRequest } from '../src/lib/fitness-client';
import { localDay } from '../src/lib/log-form';

const name = (provider: string) => provider === 'whoop' ? 'WHOOP' : provider === 'google' ? 'Google' : 'Apple';
export default function AccountScreen() {
  const { ui } = useFitnessStyles();
  const { account, snapshot, refresh } = useFitness();
  const router = useRouter();
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [available, setAvailable] = useState<AuthProvider[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [sync, setSync] = useState<Sync | null>(null);
  const [whoopMessage, setWhoopMessage] = useState('');
  const [message, setMessage] = useState('Loading account settings...');
  const [busy, setBusy] = useState(false);
  const [loadedOwner, setLoadedOwner] = useState<string>();
  const [confirm, setConfirm] = useState('');
  const [deleteText, setDeleteText] = useState('');
  const confirmedOwner = useRef<string | undefined>(undefined);
  const [shareKinds, setShareKinds] = useState(['cycle', 'sleep', 'recovery', 'workout']);
  const [shareStart, setShareStart] = useState(localDay(new Date(Date.now() - 29 * 86400000)));
  const [shareEnd, setShareEnd] = useState(localDay());
  const [shareDays, setShareDays] = useState('7');
  const owner = account?.user.id;
  const activeOwner = useRef(owner);
  activeOwner.current = owner;
  useEffect(() => { setConfirm(''); setDeleteText(''); confirmedOwner.current = undefined; }, [owner]);
  async function load() {
    if (!owner) return;
    const identities = await fitnessRequest<{ providers: AuthProvider[] }>('/users/me/identities', 'GET', undefined, owner);
    if (activeOwner.current !== owner) return;
    setProviders(identities.providers);
    setMember(null); setSync(null); setWhoopMessage('Loading WHOOP connection...'); setAvailable([]);
    setLoadedOwner(owner);
    const response = await fetch(apiBaseUrl + '/auth/providers');
    if (!response.ok) throw new Error('Unable to load sign-in options.');
    const options = await response.json();
    if (activeOwner.current !== owner) return;
    setAvailable(options.providers);
    if (identities.providers.includes('whoop')) {
      try {
      const [profile, status] = await Promise.all([
        fitnessRequest<Member>('/users/me/whoop/profile', 'GET', undefined, owner),
        fitnessRequest<Sync>('/users/me/whoop/sync', 'GET', undefined, owner),
      ]);
      if (activeOwner.current !== owner) return;
      setMember(profile); setSync(status);
      setWhoopMessage('');
      if (profile.sharePolicy) {
        setShareKinds(profile.sharePolicy.kinds);
        setShareStart(profile.sharePolicy.start ?? ''); setShareEnd(profile.sharePolicy.end ?? '');
      }
      } catch {
        if (activeOwner.current === owner) setWhoopMessage('WHOOP is temporarily unavailable. Your other account controls remain available. Refresh status to retry.');
      }
    } else { setMember(null); setSync(null); }
  }
  useEffect(() => { if (owner) void load().then(() => setMessage('Account settings loaded.')).catch((e) => setMessage(e.message)); }, [owner]);
  async function action(run: () => Promise<void>, success: string) {
    setBusy(true); setMessage('Working...');
    try { await run(); setMessage(success); setConfirm(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Please retry.'); }
    finally { setBusy(false); }
  }
  function guarded(key: string, run: () => Promise<void>, success: string) {
    if (!owner || activeOwner.current !== owner) return;
    if (confirm !== key || confirmedOwner.current !== owner) { confirmedOwner.current = owner; setConfirm(key); return; }
    void action(run, success);
  }
  async function link(provider: AuthProvider) {
    const started = await startAuthLink(provider, ExpoLinking.createURL('auth/callback'));
    await Linking.openURL(started.next);
  }
  async function signOut(discard = false) {
    if (owner && discard) await clearFitnessCache(owner, true);
    await signOutAndClearSession(); router.replace('/sign-in');
  }
  if (!owner || loadedOwner !== owner) return <FitnessPage title="Account"><Text style={ui.notice}>{message}</Text>
    <Button title="Retry loading account" disabled={busy || !owner} onPress={() => { void action(load, 'Account settings loaded.'); }} />
    <Button title="Sign out" disabled={busy || !owner || snapshot.pending > 0} onPress={() => { void action(() => signOut(), 'Signed out.'); }} />
    {!!snapshot.pending && <><Text style={ui.notice}>Unsynchronized edits will be lost if you discard them. Sync from Log first to keep them.</Text>
      <Button danger title={confirm === 'discard' ? 'Confirm discard and sign out' : 'Discard pending edits and sign out'} disabled={busy || !owner}
        onPress={() => guarded('discard', () => signOut(true), 'Local edits discarded and signed out.')} /></>}
  </FitnessPage>;
  return <FitnessPage title="Account">
    <Text accessibilityLiveRegion="polite" style={ui.notice}>{message}</Text>
    <Text style={ui.text}>{account?.user.displayName ?? 'Your account'}{account?.user.email ? ` / ${account.user.email}` : ''}</Text>
    <Card title="Sign-in methods">
      <Text style={ui.muted}>Link methods while signed in to keep one account. Matching email addresses never merge accounts automatically.</Text>
      {[...new Set([...available, ...providers])].map((provider) => <View key={provider} style={{ gap: 8 }}>
        <Text style={ui.text}>{name(provider)}: {providers.includes(provider) ? 'Linked' : 'Not linked'}</Text>
        <View style={ui.row}><Button title={providers.includes(provider) ? `Reconnect ${name(provider)}` : `Link ${name(provider)}`} disabled={busy || !owner || !available.includes(provider)}
          onPress={() => { void action(() => link(provider), 'Continue in the sign-in window.'); }} />
          {providers.includes(provider) && <Button danger disabled={busy || providers.length <= 1 || snapshot.pending > 0}
            title={confirm === provider ? `Confirm removal of ${name(provider)}` : `Remove ${name(provider)}`}
            onPress={() => guarded(provider, async () => {
              const generation = getSessionGeneration();
              await fitnessRequest(`/users/me/identities/${provider}`, 'DELETE', undefined, owner);
              if (owner) await clearFitnessCache(owner);
              if (getSessionGeneration() !== generation) return;
              await clearSession(); router.replace('/sign-in');
            }, 'Sign-in method removed. Sign in again with a remaining method.')} />}
        </View>
      </View>)}
      <Text style={ui.muted}>Keep at least one sign-in method. Removing WHOOP deletes its imported history and sharing link. Removal signs out all sessions. Sync pending entries first.</Text>
      {confirm && providers.includes(confirm as AuthProvider) && <Text style={ui.notice}>Press the confirmation button again to remove this method{confirm === 'whoop' ? ' and delete all imported WHOOP data' : ''}.</Text>}
    </Card>
    {providers.includes('whoop') && <>
      <Card title="WHOOP connection">
        {!!whoopMessage && <Text style={ui.notice}>{whoopMessage}</Text>}
        <Text style={ui.text}>{member?.connected ? 'Connected' : 'Disconnected or unavailable'}. Last sync: {sync?.lastSync ? new Date(sync.lastSync).toLocaleString() : 'Not yet complete'}.</Text>
        {sync?.jobs.map((job, i) => <Text key={i} style={ui.muted}>{job.kind}: {job.status}, {job.count} {job.mode ?? ''}{job.error ? ' - retry needed' : ''}</Text>)}
        <View style={ui.row}><Button title="Refresh status" disabled={busy} onPress={() => { void action(load, 'Status refreshed.'); }} />
          <Button title="Sync recent history" disabled={busy || !member?.connected} onPress={() => { void action(async () => { await fitnessRequest('/users/me/whoop/sync', 'POST', { full: false }, owner); await load(); }, 'Recent import queued.'); }} />
          <Button title="Backfill full history" disabled={busy || !member?.connected} onPress={() => { void action(async () => { await fitnessRequest('/users/me/whoop/sync', 'POST', { full: true }, owner); await load(); }, 'Full history import queued. Refresh status to follow progress.'); }} />
          <Button danger disabled={busy || !member?.connected} title={confirm === 'disconnect' ? 'Confirm stopping WHOOP sync' : 'Stop WHOOP sync'} onPress={() => guarded('disconnect', async () => {
            await fitnessRequest('/users/me/whoop/disconnect', 'POST', {}, owner); if (owner) await clearWhoopCache(owner); await load();
          }, 'WHOOP synchronization stopped. Reconnect to resume.')} />
        </View>
        <Text style={ui.muted}>Stopping sync revokes data access and sharing while retaining imported history and your sign-in method. Signing in with WHOOP again reconnects data access.</Text>
      </Card>
      <Card title="Share selected WHOOP history">
        <Text style={ui.muted}>Anyone with the link can view selected WHOOP data until it expires or you disable it. Manual notes and logs are never included.</Text>
        <View style={ui.row}>{['cycle', 'sleep', 'recovery', 'workout', 'body'].map((kind) => <Button key={kind}
          title={`${shareKinds.includes(kind) ? 'Included' : 'Excluded'}: ${kind}`} disabled={busy}
          onPress={() => setShareKinds((current) => current.includes(kind) ? current.filter((v) => v !== kind) : [...current, kind])} />)}</View>
        <View style={ui.row}><Field label="Share from (YYYY-MM-DD)" value={shareStart} onChange={setShareStart} /><Field label="Share through (YYYY-MM-DD)" value={shareEnd} onChange={setShareEnd} />
          <Field label="Expire in days (1-365)" value={shareDays} onChange={setShareDays} numeric /></View>
        <Button title="Save and enable sharing" disabled={busy || !member?.connected} onPress={() => { void action(async () => {
          if (!shareKinds.length || !calendarDateSchema.safeParse(shareStart).success || !calendarDateSchema.safeParse(shareEnd).success || shareStart > shareEnd || !Number.isInteger(Number(shareDays)) || Number(shareDays) < 1 || Number(shareDays) > 365) throw new Error('Choose data categories, valid dates, and an expiration between 1 and 365 days.');
          await fitnessRequest('/users/me/whoop/sharing', 'POST', { enabled: true, policy: { kinds: shareKinds, start: shareStart, end: shareEnd, expires: new Date(Date.now() + Number(shareDays) * 86400000).toISOString() } }, owner); await load();
        }, 'Sharing policy saved.'); }} />
        {member?.shareUrl && <><Text selectable style={ui.text}>{member.shareUrl}</Text>
          <Text style={ui.muted}>Expires: {member.sharePolicy?.expires ? new Date(member.sharePolicy.expires).toLocaleString() : 'No expiration set. Save a policy to add one.'}</Text>
          <Button title="Disable sharing link" disabled={busy} onPress={() => { void action(async () => { await fitnessRequest('/users/me/whoop/sharing', 'POST', { enabled: false }, owner); await load(); }, 'Sharing disabled.'); }} /></>}
      </Card>
    </>}
    <Card title="Your data">
      <Text style={ui.muted}>{snapshot.pending} pending manual changes. Exports contain synchronized server data.</Text>
      <Button title="Sync manual entries" disabled={busy} onPress={() => { void refresh(); }} />
      <Button title="Export manual data (JSON)" disabled={busy || snapshot.pending > 0} onPress={() => { void action(() => exportFitnessFile('/users/me/export', '3plates-manual.json', 'application/json'), 'Export ready.'); }} />
      {providers.includes('whoop') && <View style={ui.row}>{(['json', 'csv'] as const).map((format) => <Button key={format} title={`Export WHOOP (${format.toUpperCase()})`} disabled={busy}
        onPress={() => { void action(() => exportFitnessFile(`/users/me/whoop/export?format=${format}`, `3plates-whoop.${format}`, format === 'csv' ? 'text/csv' : 'application/json'), 'Export ready.'); }} />)}</View>}
      <Link href="/preferences" style={ui.heading}>Units and preferences</Link><Link href="/notifications" style={ui.heading}>Workout reminders</Link>
    </Card>
    <Card title="Sign out">
      <Button title="Sign out" disabled={busy || snapshot.pending > 0} onPress={() => { void action(() => signOut(), 'Signed out.'); }} />
      {snapshot.pending > 0 && <><Text style={ui.notice}>Unsynchronized edits will be lost if you discard them. Sync first to keep them.</Text>
        <Button danger title={confirm === 'discard' ? 'Confirm discard and sign out' : 'Discard pending edits and sign out'} disabled={busy}
          onPress={() => guarded('discard', () => signOut(true), 'Local edits discarded and signed out.')} /></>}
    </Card>
    <Card title="Delete account">
      <Text style={ui.muted}>Permanently delete this account, manual entries, imported WHOOP history, and sharing. All sessions stop immediately; server cleanup retries if WHOOP storage is temporarily unavailable.</Text>
      <Field label="Type DELETE to confirm account deletion" value={deleteText} onChange={setDeleteText} />
      <Button danger title={confirm === 'delete' ? 'Confirm permanent account deletion' : 'Delete my account'} disabled={busy || deleteText !== 'DELETE'}
        onPress={() => guarded('delete', async () => {
          const generation = getSessionGeneration();
          await fitnessRequest('/users/me', 'DELETE', { confirmation: 'DELETE' }, owner);
          if (owner) await clearFitnessCache(owner, true);
          if (getSessionGeneration() !== generation) return;
          await clearSession(); router.replace('/sign-in');
        }, 'Account deletion requested.')} />
    </Card>
  </FitnessPage>;
}
