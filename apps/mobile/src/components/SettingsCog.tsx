import { useMemo } from 'react';
import { useTheme, type ThemeColors } from '../lib/theme';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

export function SettingsCog() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Link href="/preferences" asChild>
      <Pressable
        style={styles.button}
        accessibilityLabel="Settings"
        accessibilityRole="link"
      >
        <Text style={styles.icon}>⚙</Text>
      </Pressable>
    </Link>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  icon: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 24,
  },
});
