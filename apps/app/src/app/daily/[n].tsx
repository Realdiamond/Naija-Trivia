/**
 * A Daily's page, whosabi.ng/daily/{n} (FR-SOC-3): the result for whoever played it; for everyone
 * else, today's Daily to play, in the browser and as a guest if need be, like a duel link.
 */
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ApiError, errorMessage } from '../../api';
import { ensureSignedIn, useSession } from '../../auth/session';
import { useDailyResult, useDailyToday } from '../../features/daily/api';
import { DailyResultView } from '../../features/daily/DailyResultView';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

export default function DailyPage() {
  const t = useT();
  const { n } = useLocalSearchParams<{ n: string }>();
  const id = Number(n);
  const valid = Number.isInteger(id) && id > 0;
  const status = useSession((s) => s.status);
  const signedIn = status === 'guest' || status === 'account';
  const result = useDailyResult(id, signedIn && valid);
  const today = useDailyToday(signedIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (result.data) return <DailyResultView result={result.data} />;

  const play = async () => {
    setBusy(true);
    setError(null);
    try {
      if ((await ensureSignedIn()) === 'account_device') {
        router.push({ pathname: '/sign-in', params: { reason: 'device' } });
        return;
      }
      router.replace('/daily/play');
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
    } finally {
      setBusy(false);
    }
  };

  const loading = status === 'loading' || result.isLoading || today.isLoading;
  const missing = !valid || (result.error instanceof ApiError && result.error.status === 404);
  const todayId = today.data?.id;
  const past = todayId !== undefined && valid && id < todayId;
  const playedToday = today.data?.played === true;

  return (
    <Screen
      back
      backTo={signedIn ? '/home' : '/welcome'}
      footer={
        loading ? null : playedToday ? (
          <Button label={t('home.seeResult')} onPress={() => router.replace(`/daily/${todayId}`)} />
        ) : (
          <Button
            label={t('daily.play')}
            trailingIcon="arrow-right"
            variant="accent"
            loading={busy}
            onPress={() => void play()}
            testID="daily-play"
          />
        )
      }
    >
      {loading ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} size="large" />
      ) : (
        <View style={styles.card}>
          <Icon name="calendar" size={48} color={colors.accentInk} />
          <Text variant="display" align="center" accessibilityRole="header" testID="daily-landing-title">
            {missing
              ? t('daily.missing')
              : past
                ? t('daily.pastTitle', { id })
                : t('daily.title', { id: todayId ?? id })}
          </Text>
          <Text variant="bodySoft" align="center">
            {past ? t('daily.pastBody', { today: todayId! }) : t('daily.landingBody')}
          </Text>
        </View>
      )}
      {error ? (
        <Text variant="body" color={colors.wrongInk} align="center" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 80 },
  card: {
    alignItems: 'center',
    gap: 16,
    marginTop: 32,
    padding: 24,
    borderRadius: radius.card,
    backgroundColor: colors.accentTint,
  },
});
