import { useMemo } from 'react';
import { useTheme, type ThemeColors } from '../lib/theme';
import { Link, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SettingsCog } from './SettingsCog';

type ScreenHeaderProps = {
  title: string;
};

export function ScreenHeader({ title }: ScreenHeaderProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();

  return (
    <View style={styles.headerRow}>
      <View style={styles.headerLeft}>
        <View style={styles.navRow}>
          <Pressable
            style={styles.navButton}
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={() => router.back()}
          >
            <Text style={styles.navButtonText}>Back</Text>
          </Pressable>

          <Link href="/" asChild>
            <Pressable
              style={styles.navButton}
              accessibilityLabel="Go home"
              accessibilityRole="link"
            >
              <Text style={styles.navButtonText}>Home</Text>
            </Pressable>
          </Link>
        </View>
        <Text style={styles.title}>{title}</Text>
      </View>

      <SettingsCog />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  headerRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  navRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  navButton: {
    minHeight: 36,
    minWidth: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  navButtonText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.ink,
  },
});
