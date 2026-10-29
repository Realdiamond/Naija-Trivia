/** Sends the player where they belong: the welcome, finishing their profile, or home. */
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { restoreSession, useSession } from '../auth/session';
import { loadPractice, usePractice } from '../features/practice/store';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors } from '../ui/theme';

export default function Index() {
  const { status, user } = useSession();
  const t = useT();
  // Offline, packs saved on this device still play (UX §4).
  const savedPacks = usePractice((s) => Object.keys(s.packs).length);
  useEffect(() => {
    void loadPractice();
  }, []);

  if (status === 'loading') {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.white} size="large" />
      </View>
    );
  }
  if (status === 'offline') {
    return (
      <Screen>
        <View style={styles.offline}>
          <Text variant="heading" align="center">
            {t('error.network')}
          </Text>
          <Button label={t('error.retry')} onPress={() => void restoreSession()} />
          {savedPacks > 0 ? (
            <Button
              label={t('practice.offlineCta')}
              variant="outline"
              icon="book"
              onPress={() => router.push('/practice')}
              testID="practice-offline"
            />
          ) : null}
        </View>
      </Screen>
    );
  }
  if (status === 'signed_out') return <Redirect href="/welcome" />;
  if (status === 'account' && !user?.username) return <Redirect href="/profile-setup" />;
  return <Redirect href="/home" />;
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  offline: { flex: 1, justifyContent: 'center', gap: 20 },
});
