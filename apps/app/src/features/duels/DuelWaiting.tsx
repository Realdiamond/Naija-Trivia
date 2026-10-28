/** Waiting for the opponent's turn, with the link to send while nobody has taken it yet. */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { DuelView } from '@whosabi/shared-types';
import { errorMessage } from '../../api';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors } from '../../ui/theme';
import { duelKeys, duels } from './api';
import { timeLeft } from './format';
import { LinkShare } from './LinkShare';
import { RoundChips, Scoreline, useOpponentName } from './parts';

export function DuelWaiting({ duel }: { duel: DuelView }) {
  const t = useT();
  const name = useOpponentName(duel);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = timeLeft(duel.turn_deadline, Date.now());
  const time = !left
    ? ''
    : 'hours' in left
      ? t('time.hoursLeft', { hours: left.hours })
      : t('time.minutesLeft', { minutes: left.minutes });
  // The challenger can call it off until the opponent has answered anything.
  const canCancel = duel.you === 'a' && (duel.rounds[0]?.opponent?.answered ?? 0) === 0;

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(duelKeys.one(duel.id), await duels.cancel(duel.id));
      void queryClient.invalidateQueries({ queryKey: duelKeys.all });
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      back
      backTo="/home"
      footer={<Button label={t('duel.home')} variant="outline" onPress={() => router.replace('/home')} />}
    >
      <Text variant="label" align="center">
        {t('duel.vs', { name })}
      </Text>
      <Scoreline duel={duel} />
      <RoundChips duel={duel} />
      <Text variant="title" accessibilityRole="header" style={styles.title} testID="waiting-title">
        {t('duel.waitingTitle')}
      </Text>
      {time && duel.opponent ? <Text variant="bodySoft">{t('duel.waitingBody', { name, time })}</Text> : null}
      {duel.invite_url ? <LinkShare url={duel.invite_url} /> : null}
      {canCancel ? (
        <View style={styles.cancel}>
          <Button label={t('duel.cancel')} variant="link" loading={busy} onPress={() => void cancel()} />
        </View>
      ) : null}
      {error ? (
        <Text variant="body" color={colors.wrongInk}>
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 8, marginBottom: 4 },
  cancel: { marginTop: 8, alignItems: 'center' },
});
