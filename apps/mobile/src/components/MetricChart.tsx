import { Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { useFitnessStyles } from './FitnessUI';

export function MetricChart({ label, points, scatter = false }: {
  label: string; points: Array<{ label: string; value: number | null; x?: number }>; scatter?: boolean;
}) {
  const { ui, colors } = useFitnessStyles();
  const available = points.filter((point) => point.value !== null && Number.isFinite(point.value));
  if (!available.length) return <Text style={ui.muted}>{label}: no scored observations.</Text>;
  const values = available.map((point) => point.value!);
  const min = Math.min(...values); const max = Math.max(...values);
  const xs = available.map((point) => point.x ?? 0);
  const xmin = Math.min(...xs); const xmax = Math.max(...xs);
  const xy = (point: typeof points[number], index: number) => ({
    x: 45 + 620 * (scatter ? ((point.x ?? 0) - xmin) / (xmax - xmin || 1) : index / Math.max(1, points.length - 1)),
    y: 175 - 145 * (point.value! - min) / (max - min || 1),
  });
  const segments: string[][] = [[]];
  points.forEach((point, index) => {
    if (point.value === null || !Number.isFinite(point.value)) { if (segments.at(-1)!.length) segments.push([]); return; }
    const { x, y } = xy(point, index); segments.at(-1)!.push(`${x},${y}`);
  });
  return <View accessible accessibilityRole="image" style={{ gap: 6 }} accessibilityLabel={`${label}. ${available.length} observations. Minimum ${min.toFixed(1)}, maximum ${max.toFixed(1)}.`}>
    <Text style={ui.heading}>{label}</Text>
    <Svg viewBox="0 0 700 210" width="100%" height={210} accessible={false}>
      <Line x1={45} y1={175} x2={665} y2={175} stroke={colors.border} />
      <SvgText x={3} y={35} fontSize={12} fill={colors.muted}>{max.toFixed(1)}</SvgText>
      <SvgText x={3} y={175} fontSize={12} fill={colors.muted}>{min.toFixed(1)}</SvgText>
      {!scatter && segments.map((segment, i) => <Polyline key={i} points={segment.join(' ')} fill="none" stroke={colors.accent} strokeWidth={2} />)}
      {points.map((point, i) => point.value === null || !Number.isFinite(point.value) ? null : <Circle key={i} cx={xy(point, i).x} cy={xy(point, i).y} r={scatter ? 3 : 2} fill={colors.accent} />)}
      <SvgText x={45} y={200} fontSize={12} fill={colors.muted}>{scatter ? xmin.toFixed(1) : points[0]?.label}</SvgText>
      <SvgText x={665} y={200} textAnchor="end" fontSize={12} fill={colors.muted}>{scatter ? xmax.toFixed(1) : points.at(-1)?.label}</SvgText>
    </Svg>
    <Text style={ui.muted}>{available.length} observations. Missing readings remain gaps.</Text>
  </View>;
}
