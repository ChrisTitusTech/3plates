import { Text, View } from 'react-native';
import type { Dashboard } from '@3plates/whoop/types';
import { ui } from './FitnessUI';

export function WhoopDetail({ detail }: { detail: Dashboard['details'][number] }) {
  return <View style={{ gap: 5 }}>
    <Text style={ui.heading}>{detail.date} / {detail.sport ?? detail.kind}{detail.nap ? ' (nap)' : ''}</Text>
    <Text style={ui.muted}>WHOOP / {detail.state} / {detail.start}{detail.end ? ` to ${detail.end}` : ''}</Text>
    {Object.entries(detail.metrics).map(([name, value]) => <Text key={name} style={ui.text}>
      {name.replaceAll('_', ' ')}: {value === null ? 'Not available' : Number(value.toFixed(2))}
    </Text>)}
  </View>;
}
