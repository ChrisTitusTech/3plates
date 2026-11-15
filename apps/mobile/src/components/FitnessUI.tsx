import { useMemo, type PropsWithChildren } from 'react';
import { Link, usePathname } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type ThemeColors } from '../lib/theme';

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flexGrow: 1, padding: 20, gap: 18, width: '100%', maxWidth: 1080, alignSelf: 'center' },
  title: { fontSize: 30, fontWeight: '800', color: colors.ink },
  heading: { fontSize: 20, fontWeight: '700', color: colors.ink },
  text: { fontSize: 16, lineHeight: 24, color: colors.ink },
  muted: { fontSize: 14, lineHeight: 21, color: colors.muted },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 18, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  field: { gap: 6, flexGrow: 1, minWidth: 140 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: colors.surface, color: colors.ink, fontSize: 16 },
  button: { minHeight: 46, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.onAccent, fontWeight: '700', fontSize: 15 },
  notice: { padding: 14, borderRadius: 10, backgroundColor: colors.light, color: colors.ink, lineHeight: 22 },
});
export function useFitnessStyles() {
  const { colors } = useTheme();
  const ui = useMemo(() => createStyles(colors), [colors]);
  return { ui, colors };
}
export function Button({ title, onPress, disabled = false, danger = false }: {
  title: string; onPress(): void; disabled?: boolean; danger?: boolean;
}) {
  const { ui, colors } = useFitnessStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[ui.button, danger && { backgroundColor: colors.danger }, disabled && { opacity: 0.5 }]}>
    <Text style={[ui.buttonText, danger && { color: colors.onDanger }]}>{title}</Text>
  </Pressable>;
}
export function Field({ label, value, onChange, numeric = false, multiline = false }: {
  label: string; value: string; onChange(value: string): void; numeric?: boolean; multiline?: boolean;
}) {
  const { ui, colors } = useFitnessStyles();
  return <View style={ui.field}><Text style={ui.muted}>{label}</Text><TextInput accessibilityLabel={label}
    style={[ui.input, multiline && { minHeight: 90, textAlignVertical: 'top' }]} value={value} onChangeText={onChange}
    placeholderTextColor={colors.muted} selectionColor={colors.accent}
    keyboardType={numeric ? 'decimal-pad' : 'default'} multiline={multiline} autoCapitalize="none" /></View>;
}
export function Card({ title, children }: PropsWithChildren<{ title?: string }>) {
  const { ui } = useFitnessStyles();
  return <View style={ui.card}>{title && <Text accessibilityRole="header" style={ui.heading}>{title}</Text>}{children}</View>;
}
export function FitnessPage({ title, children }: PropsWithChildren<{ title: string }>) {
  const { ui, colors } = useFitnessStyles();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const tabs = [['/today', 'Today'], ['/log', 'Log'], ['/training', 'Workouts'], ['/trends', 'Trends'], ['/account', 'Account']] as const;
  return <ScrollView testID="fitness-page" style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={[ui.page, { paddingTop: 20 + insets.top, paddingBottom: 20 + insets.bottom, paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right }]} keyboardShouldPersistTaps="handled">
    <Text style={ui.muted}>3PLATES / YOUR FITNESS, TOGETHER</Text>
    <Text accessibilityRole="header" style={ui.title}>{title}</Text>
    <AppearanceControls />
    <View style={ui.row}>{tabs.map(([href, label]) => <Link key={href} href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityState={{ selected: path === href }}
        style={StyleSheet.flatten([ui.button, { backgroundColor: path === href ? colors.strong : colors.surface, borderColor: colors.border, borderWidth: 1 }])}>
        <Text style={[ui.buttonText, { color: path === href ? colors.onStrong : colors.ink }]}>{label}</Text>
      </Pressable>
    </Link>)}</View>
    {children}
  </ScrollView>;
}

export function AppearanceControls() {
  const theme = useTheme();
  const { ui, colors } = useFitnessStyles();
  return <View style={{ gap: 8 }}>
    <View style={ui.row} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
      <Text style={ui.muted}>Appearance</Text>
      {(['light', 'dark', 'system'] as const).map((mode) => <Pressable key={mode}
        accessibilityRole="radio" accessibilityLabel={`Theme: ${mode === 'system' ? 'Follow system' : mode === 'dark' ? 'Dark' : 'Light'}`}
        aria-checked={theme.mode === mode} accessibilityState={{ checked: theme.mode === mode, disabled: theme.busy || !theme.available }} disabled={theme.busy || !theme.available}
        onPress={() => { void theme.choose(mode); }}
        style={[ui.button, { backgroundColor: theme.mode === mode ? colors.strong : colors.surface, borderWidth: 1, borderColor: colors.border, opacity: theme.busy || !theme.available ? 0.5 : 1 }]}>
        <Text style={[ui.buttonText, { color: theme.mode === mode ? colors.onStrong : colors.ink }]}>{mode === 'system' ? 'Follow system' : mode === 'dark' ? 'Dark' : 'Light'}</Text>
      </Pressable>)}
    </View>
    {!!theme.message && <Text accessibilityLiveRegion="polite" style={ui.muted}>{theme.message}</Text>}
    {!theme.available && !theme.busy && <Button title="Retry appearance settings" onPress={theme.retry} />}
  </View>;
}
