/**
 * The root of the app: fonts, the saved language, Data Saver, the session, the analytics tracker,
 * push notifications, the web app's service worker and the navigation stack. Screens decide
 * where a player goes from the session (see index.tsx).
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { router, Stack, usePathname, useSegments } from 'expo-router';
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
import { countSession } from '../ads/pacing';
import { appVisible, screenName, startAnalytics, trackEvent, trackScreen } from '../analytics';
import { queryClient } from '../api/queryClient';
import { restoreSession, useSession } from '../auth/session';
import { ConsentBanner } from '../features/consent/ConsentBanner';
import { loadConsent } from '../features/consent/store';
import { startDataSaver } from '../features/dataSaver/store';
import { showsSideNav, SideNav } from '../features/nav/SideNav';
import { useLanguage } from '../i18n';
import '../platform/install';
import { startCrashReports, withCrashReports } from '../platform/crashReports';
import { syncPush, usePushHandlers } from '../platform/push';
import { startServiceWorker } from '../platform/serviceWorker';
import { useIsDesktop } from '../ui/layout';
import { colors } from '../ui/theme';

// As early as possible, so a crash while starting up is reported too (step 2.8e).
startCrashReports();

export default withCrashReports(RootLayout);

function RootLayout() {
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
  const pathname = usePathname();
  const desktop = useIsDesktop();
  const signedIn = useSession((s) => s.status === 'guest' || s.status === 'account');
  // A tapped push opens its screen once someone is signed in (on a cold start, after restore).
  const [pushUrl, setPushUrl] = useState<string | null>(null);

  usePushHandlers({
    open: (target) => {
      trackEvent('push_opened', { type: target.type });
      setPushUrl(target.url);
    },
    received: (target) => {
      trackEvent('push_received', { type: target.type });
      // Whatever it is about (a turn, a result, a request) is now out of date on screen.
      void queryClient.invalidateQueries();
    },
  });
  useEffect(() => {
    if (signedIn && pushUrl) {
      // Already there (a browser window a push just opened): nothing to stack.
      if (pushUrl !== pathname) router.push(pushUrl as Parameters<typeof router.push>[0]);
      setPushUrl(null);
    }
  }, [signedIn, pushUrl, pathname]);
  useEffect(() => {
    if (signedIn) void syncPush();
  }, [signedIn]);
  // Once the fonts are in, so the worker is handed them with the bundles (step 2.8c).
  const ready = fontsLoaded || Boolean(fontError);
  useEffect(() => {
    if (ready) void startServiceWorker();
  }, [ready]);

  useEffect(() => {
    void useLanguage.getState().load();
    void loadConsent();
    const stopDataSaver = startDataSaver();
    void countSession();
    void restoreSession();
    void startAnalytics().then(() => setAnalyticsReady(true));
    const sub = AppState.addEventListener('change', (state) => appVisible(state === 'active'));
    return () => {
      sub.remove();
      stopDataSaver();
    };
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
        <View style={styles.frame}>
          <View style={styles.main}>
            {desktop && signedIn && showsSideNav(pathname) ? <SideNav /> : null}
            <View style={styles.content}>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
                <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
                <Stack.Screen name="taste" options={{ gestureEnabled: false }} />
              </Stack>
            </View>
          </View>
          <ConsentBanner />
        </View>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.bg },
  main: { flex: 1, flexDirection: 'row' },
  content: { flex: 1 },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
});
