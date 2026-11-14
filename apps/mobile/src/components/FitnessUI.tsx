import type { PropsWithChildren } from 'react';
import { Link, usePathname } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

export const colors = { ink: '#142b38', muted: '#526975', accent: '#087f73', light: '#edf7f4', border: '#d6e2e6', danger: '#a52c36', background: '#f4f7f9' };
export const ui = StyleSheet.create({
  page: { flexGrow: 1, padding: 20, gap: 18, width: '100%', maxWidth: 1080, alignSelf: 'center' },
  title: { fontSize: 30, fontWeight: '800', color: colors.ink },
  heading: { fontSize: 20, fontWeight: '700', color: colors.ink },
  text: { fontSize: 16, lineHeight: 24, color: colors.ink },
  muted: { fontSize: 14, lineHeight: 21, color: colors.muted },
  card: { backgroundColor: '#fff', borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 18, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  field: { gap: 6, flexGrow: 1, minWidth: 140 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: '#fff', color: colors.ink, fontSize: 16 },
  button: { minHeight: 46, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  notice: { padding: 14, borderRadius: 10, backgroundColor: colors.light, color: colors.ink, lineHeight: 22 },
});
export function Button({ title, onPress, disabled = false, danger = false }: {
  title: string; onPress(): void; disabled?: boolean; danger?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[ui.button, danger && { backgroundColor: colors.danger }, disabled && { opacity: 0.5 }]}>
    <Text style={ui.buttonText}>{title}</Text>
  </Pressable>;
}
export function Field({ label, value, onChange, numeric = false, multiline = false }: {
  label: string; value: string; onChange(value: string): void; numeric?: boolean; multiline?: boolean;
}) {
  return <View style={ui.field}><Text style={ui.muted}>{label}</Text><TextInput accessibilityLabel={label}
    style={[ui.input, multiline && { minHeight: 90, textAlignVertical: 'top' }]} value={value} onChangeText={onChange}
    keyboardType={numeric ? 'decimal-pad' : 'default'} multiline={multiline} autoCapitalize="none" /></View>;
}
export function Card({ title, children }: PropsWithChildren<{ title?: string }>) {
  return <View style={ui.card}>{title && <Text accessibilityRole="header" style={ui.heading}>{title}</Text>}{children}</View>;
}
export function FitnessPage({ title, children }: PropsWithChildren<{ title: string }>) {
  const path = usePathname();
  const tabs = [['/today', 'Today'], ['/log', 'Log'], ['/training', 'Workouts'], ['/trends', 'Trends'], ['/account', 'Account']] as const;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
    <Text style={ui.muted}>3PLATES / YOUR FITNESS, TOGETHER</Text>
    <Text accessibilityRole="header" style={ui.title}>{title}</Text>
    <View style={ui.row}>{tabs.map(([href, label]) => <Link key={href} href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityState={{ selected: path === href }}
        style={StyleSheet.flatten([ui.button, { backgroundColor: path === href ? colors.ink : '#fff', borderColor: colors.border, borderWidth: 1 }])}>
        <Text style={[ui.buttonText, { color: path === href ? '#fff' : colors.ink }]}>{label}</Text>
      </Pressable>
    </Link>)}</View>
    {children}
  </ScrollView>;
}
