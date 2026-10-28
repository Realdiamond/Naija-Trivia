/** A new challenge, before the first answer: play the turn or decline (only allowed before playing). */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { DuelView } from '@whosabi/shared-types';
import { errorMessage } from '../../api';
import { useT } from '../../i18n';
import { InitialAvatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors } from '../../ui/theme';
import { duelKeys, duels } from './api';
import { RoundChips, Scoreline, useOpponentName } from './parts';

export function DuelIntro({ duel, onPlay }: { duel: DuelView; onPlay: () => void }) {
  const t = useT();
  const name = useOpponentName(duel);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decline = async () => {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(duelKeys.one(duel.id), await duels.decline(duel.id));
      void queryClient.invalidateQueries({ queryKey: duelKeys.all });
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
      setBusy(false);
    }
  };

  return (
    <Screen
      back
      backTo="/home"
      footer={
        <>
          <Button
            label={t('duel.playNext', { round: 1 })}
            trailingIcon="arrow-right"
            onPress={onPlay}
            testID="intro-play"
          />
          <Button
            label={t('duel.decline')}
            variant="link"
            loading={busy}
            onPress={() => void decline()}
            testID="intro-decline"
          />
        </>
      }
    >
      <View style={styles.top}>
        <InitialAvatar name={name} size={80} />
        <Text variant="display" align="center" accessibilityRole="header">
          {t('invite.title', { name })}
        </Text>
        <Text variant="bodySoft" align="center">
          {t('duel.declinePrompt', { name })}
        </Text>
      </View>
      <Scoreline duel={duel} />
      <RoundChips duel={duel} current={1} />
      {error ? (
        <Text variant="body" color={colors.wrongInk}>
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ top: { alignItems: 'center', gap: 12, marginVertical: 16 } });
