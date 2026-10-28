/** Sends the player where they belong: the welcome, finishing their profile, or home. */
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { restoreSession, useSession } from '../auth/session';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors } from '../ui/theme';

export default function Index() {
  const { status, user } = useSession();
  const t = useT();

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
