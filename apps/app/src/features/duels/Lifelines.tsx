/**
 * The lifeline row under a duel question (mockup 11, GDD §5.2): 50/50, Ask Naija, Skip and +10s,
 * one of each per duel, paid for with coins. The server decides what each shows and takes the
 * coins; the row only asks.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { lifelineCost, LIFELINES } from '@whosabi/game-rules';
import type { Lifeline, Wallet } from '@whosabi/shared-types';
import { errorMessage } from '../../api';
import { useT, type MessageKey } from '../../i18n';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';
import { useWallet, walletKeys } from '../economy/api';
import type { QuestionFlow } from '../play/useQuestionFlow';
import { duels } from './api';

interface Props {
  duelId: string;
  round: number;
  flow: QuestionFlow;
}

export function LifelineRow({ duelId, round, flow }: Props) {
  const t = useT();
  const queryClient = useQueryClient();
  const wallet = useWallet(true);
  const [busy, setBusy] = useState<Lifeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const question = flow.question;
  if (!question?.lifelines) return null;
  const { used } = question.lifelines;
  const coins = wallet.data?.coins ?? 0;

  const use = async (type: Lifeline) => {
    setBusy(type);
    setError(null);
    try {
      const res = await duels.lifeline(duelId, { type, round, seq: question.seq });
      queryClient.setQueryData<Wallet>(walletKeys.balance, (w) => ({ gems: w?.gems ?? 0, coins: res.coins }));
      void queryClient.invalidateQueries({ queryKey: walletKeys.history });
      flow.replace(res.question);
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {LIFELINES.map((type) => {
          const cost = lifelineCost(type);
          const spent = used.includes(type);
          // 50/50 needs four options to take two away.
          const fits = type !== 'fifty' || question.options.length === 4;
          const disabled = spent || !fits || cost > coins || busy !== null || flow.phase !== 'asking';
          return (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              accessibilityLabel={`${t(`lifeline.${type}` as MessageKey)}, ${t('lifeline.cost', { coins: cost })}`}
              disabled={disabled}
              onPress={() => void use(type)}
              style={({ pressed }) => [styles.button, disabled && styles.off, pressed && styles.pressed]}
              testID={`lifeline-${type}`}
            >
              <Text variant="label" align="center">
                {t(`lifeline.${type}` as MessageKey)}
              </Text>
              <Text variant="caption" align="center">
                {spent ? t('lifeline.used') : t('lifeline.cost', { coins: cost })}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text variant="caption" color={colors.wrongInk} align="center" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : wallet.data ? (
        <Text variant="caption" align="center" testID="lifeline-coins">
          {t('lifeline.coins', { coins: coins.toLocaleString('en-NG') })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  button: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 2,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  off: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
});
