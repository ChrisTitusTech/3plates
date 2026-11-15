import '../src/lib/fitness-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, useTheme } from '../src/lib/theme';

export default function RootLayout() {
  return <ThemeProvider><ThemedLayout /></ThemeProvider>;
}
function ThemedLayout() {
  const { resolved, colors } = useTheme();
  return (
    <>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </>
  );
}
