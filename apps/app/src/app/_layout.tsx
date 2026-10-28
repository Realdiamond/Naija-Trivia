/**
 * The root of the app: fonts, the saved language, the session, the analytics tracker and the
 * navigation stack. Screens decide where a player goes from the session (see index.tsx).
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { Baloo2_800ExtraBold } from '@expo-google-fonts/baloo-2';
import { appVisible, screenName, startAnalytics, trackScreen } from '../analytics';
import { queryClient } from '../api/queryClient';
import { restoreSession } from '../auth/session';
import { useLanguage } from '../i18n';
import { colors } from '../ui/theme';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Baloo2_800ExtraBold,
  });
  const languageLoaded = useLanguage((s) => s.loaded);
  const [analyticsReady, setAnalyticsReady] = useState(false);
  const segments = useSegments();

  useEffect(() => {
    void useLanguage.getState().load();
    void restoreSession();
    void startAnalytics().then(() => setAnalyticsReady(true));
    const sub = AppState.addEventListener('change', (state) => appVisible(state === 'active'));
    return () => sub.remove();
  }, []);

  const screen = screenName(segments);
  useEffect(() => {
    if (analyticsReady) trackScreen(screen);
  }, [screen, analyticsReady]);

  // Text in fallback fonts is better than a blank screen if a font fails to load.
  if ((!fontsLoaded && !fontError) || !languageLoaded) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.white} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
          <Stack.Screen name="taste" options={{ gestureEnabled: false }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
});
