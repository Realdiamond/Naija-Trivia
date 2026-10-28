/** First open (mockup 01): the name, the language and straight into the taste test. */
import { useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { routes } from '@whosabi/shared-types';
import { api, errorMessage } from '../api';
import { ensureSignedIn } from '../auth/session';
import { useLanguage, useT, type AppLanguage } from '../i18n';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { colors, CONTENT_MAX_WIDTH, fonts } from '../ui/theme';

export default function Welcome() {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      if ((await ensureSignedIn()) === 'account_device') {
        router.push({ pathname: '/sign-in', params: { reason: 'device' } });
        return;
      }
      // The server uses it for reminders in the player's language (FR-NOT-3).
      void api.patch(routes.me(), { language }).catch(() => undefined);
      router.push('/taste');
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Pattern start="dark" />
      {/* Scrolls when the screen is short, e.g. with the consent banner showing. */}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.column}>
          <View style={styles.top}>
            <Logo />
            <Text variant="hero" accessibilityRole="header" style={styles.title}>
              Who{'\n'}Sabi?
            </Text>
            <Text style={styles.tagline} color={colors.white}>
              {t('welcome.tagline')}
            </Text>
          </View>

          <View style={styles.bottom}>
            <Text variant="label" color={colors.white}>
              {t('welcome.language')}
            </Text>
            <View style={styles.languages} accessibilityRole="radiogroup">
              {(
                [
                  ['en', 'English'],
                  ['pcm', 'Pidgin'],
                ] as Array<[AppLanguage, string]>
              ).map(([code, name]) => (
                <Button
                  key={code}
                  label={name}
                  variant={language === code ? 'light' : 'ghost-light'}
                  selected={language === code}
                  onPress={() => setLanguage(code)}
                  style={styles.language}
                  testID={`language-${code}`}
                />
              ))}
            </View>
            <Button
              label={t('welcome.start')}
              variant="accent"
              trailingIcon="arrow-right"
              loading={busy}
              onPress={() => void start()}
              testID="start"
            />
            {error ? (
              <Text variant="body" color={colors.white} align="center" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : (
              <Text variant="body" color={colors.white} align="center" style={styles.note}>
                {t('welcome.note')}
              </Text>
            )}
            <Button
              label={t('welcome.haveAccount')}
              variant="link-light"
              size="medium"
              onPress={() => router.push('/sign-in')}
              style={styles.haveAccount}
            />
          </View>
        </View>
      </ScrollView>
      <Pattern start="light" />
    </SafeAreaView>
  );
}

function Logo() {
  return (
    <View style={styles.logoWrap} accessibilityElementsHidden importantForAccessibility="no">
      <View style={styles.logo}>
        <Text style={styles.logoMark}>?</Text>
      </View>
      <View style={styles.logoDot} />
    </View>
  );
}

/** The Ankara-style border strip: green tiles with orange dots, orange tiles with white diamonds. */
function Pattern({ start }: { start: 'dark' | 'light' }) {
  const { width } = useWindowDimensions();
  const tile = 39;
  const count = Math.ceil(width / tile);
  return (
    <View style={styles.pattern} accessibilityElementsHidden importantForAccessibility="no">
      {Array.from({ length: count }, (_, i) => {
        const dark = (i % 2 === 0) === (start === 'dark');
        return (
          <View key={i} style={[styles.tile, { backgroundColor: dark ? colors.primaryInk : colors.accent }]}>
            <View style={dark ? styles.dot : styles.diamond} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  scroll: { flexGrow: 1 },
  column: {
    flexGrow: 1,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
    justifyContent: 'space-between',
  },
  top: { gap: 16, paddingTop: 24 },
  title: { marginTop: 8 },
  tagline: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 27 },
  bottom: { gap: 14, paddingTop: 32 },
  languages: { flexDirection: 'row', gap: 12 },
  language: { flex: 1 },
  note: { fontFamily: fonts.regular },
  haveAccount: { alignSelf: 'center' },
  logoWrap: { width: 110, height: 90 },
  logo: {
    width: 78,
    height: 78,
    borderRadius: 22,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-4deg' }],
  },
  logoMark: { fontFamily: fonts.display, fontSize: 52, lineHeight: 64, color: colors.primaryInk },
  logoDot: {
    position: 'absolute',
    left: 86,
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  pattern: { flexDirection: 'row', height: 39, overflow: 'hidden' },
  tile: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 15, height: 15, borderRadius: 8, backgroundColor: colors.accent },
  diamond: { width: 13, height: 13, backgroundColor: colors.white, transform: [{ rotate: '45deg' }] },
});
