/** Pick the category for a round (mockup 10): three offered at random, the opponent sees the pick. */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { DuelView } from '@whosabi/shared-types';
import { errorMessage } from '../../api';
import { useT } from '../../i18n';
import { useXpBoosted } from '../liveops/HomeBanners';
import { Icon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { category, colors, radius } from '../../ui/theme';
import { duelKeys, duels } from './api';
import { RoundChips, Scoreline, useOpponentName } from './parts';

export function PickCategory({ duel, round, offered }: { duel: DuelView; round: number; offered: string[] }) {
  const t = useT();
  const name = useOpponentName(duel);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boosted = useXpBoosted();

  const pick = async (categoryId: string) => {
    setBusy(categoryId);
    setError(null);
    try {
      queryClient.setQueryData(duelKeys.one(duel.id), await duels.pickCategory(duel.id, round, categoryId));
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
      setBusy(null);
    }
  };

  return (
    <Screen
      back
      backTo="/home"
      footer={
        <Text variant="caption" align="center">
          {t('duel.pickFooter')}
        </Text>
      }
    >
      <Text variant="label" align="center">
        {t('duel.vs', { name })}
      </Text>
      <Scoreline duel={duel} />
      <RoundChips duel={duel} current={round} />
      <Text variant="display" accessibilityRole="header" style={styles.title}>
        {t('duel.pickTitle', { round })}
      </Text>
      <Text variant="bodySoft">{t('duel.pickBody', { name })}</Text>
      <View style={styles.options}>
        {offered.map((id) => {
          const c = category(id);
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={c.name}
              disabled={busy !== null}
              onPress={() => void pick(id)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed, busy === id && styles.busy]}
              testID={`category-${id}`}
            >
              <View style={[styles.icon, { backgroundColor: c.color }]}>
                <Text style={styles.emoji}>{c.emoji}</Text>
              </View>
              <View style={styles.optionText}>
                <Text variant="heading">{c.name}</Text>
                <Text variant="bodySoft">{c.blurb}</Text>
                {boosted(id) ? (
                  <Text variant="label" color={colors.primaryInk} testID={`boost-${id}`}>
                    {t('event.doubleXp')}
                  </Text>
                ) : null}
              </View>
              <View style={styles.chevron}>
                <Icon name="back" size={20} />
              </View>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text variant="body" color={colors.wrongInk} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 8 },
  options: { gap: 12, marginTop: 16, marginBottom: 12 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 14,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85 },
  busy: { borderColor: colors.primary },
  icon: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 26, lineHeight: 32 },
  optionText: { flex: 1, gap: 2 },
  chevron: { transform: [{ rotate: '180deg' }] },
});
