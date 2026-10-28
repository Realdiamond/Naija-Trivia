/** Pieces shared by the duel screens: the opponent's name, the score and the three rounds. */
import { StyleSheet, View } from 'react-native';
import type { DuelSummary, DuelView } from '@whosabi/shared-types';
import { useT } from '../../i18n';
import { Text } from '../../ui/Text';
import { category, colors, fonts, radius } from '../../ui/theme';
import { playerName } from './format';

export function useOpponentName(duel: DuelSummary): string {
  const t = useT();
  // A random duel still looking for its second player.
  if (!duel.opponent && duel.source === 'random') return t('duel.findingName');
  return playerName(duel.opponent, t('duel.guestOpponent'), t('duel.someone'));
}

/** "You 833 to 830 Chidi". */
export function Scoreline({ duel }: { duel: DuelSummary }) {
  const t = useT();
  const name = useOpponentName(duel);
  return (
    <View style={styles.scoreline} testID="scoreline">
      <View style={styles.side}>
        <Text variant="caption">{t('duel.you')}</Text>
        <Text style={styles.score} color={colors.primaryInk}>
          {duel.score.you.toLocaleString('en-NG')}
        </Text>
      </View>
      <Text variant="bodySoft" style={styles.to}>
        {t('duel.to')}
      </Text>
      <View style={styles.side}>
        <Text variant="caption" numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.score}>{duel.score.opponent.toLocaleString('en-NG')}</Text>
      </View>
    </View>
  );
}

/** The three rounds with their category and who picked it; `current` is outlined. */
export function RoundChips({ duel, current }: { duel: DuelView; current?: number }) {
  const t = useT();
  const name = useOpponentName(duel);
  return (
    <View style={styles.chips}>
      {duel.rounds.map((round) => {
        const active = round.round === current;
        const picker =
          round.picked_by === 'you'
            ? t('duel.yourPick')
            : round.picked_by === 'opponent'
              ? t('duel.theirPick', { name })
              : active
                ? t('duel.yourPick')
                : '';
        return (
          <View key={round.round} style={[styles.chip, active && styles.chipActive]}>
            <Text variant="caption" color={active ? colors.primaryInk : colors.inkSoft} align="center">
              {t('duel.roundN', { round: round.round })}
            </Text>
            <Text
              variant="label"
              align="center"
              numberOfLines={1}
              color={active ? colors.primaryInk : colors.ink}
            >
              {round.category_id ? category(round.category_id).name.split(' ')[0] : '?'}
            </Text>
            <Text
              variant="caption"
              align="center"
              numberOfLines={1}
              color={active ? colors.primaryInk : colors.muted}
            >
              {picker}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  scoreline: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 20,
    marginVertical: 8,
  },
  side: { alignItems: 'center', maxWidth: 140 },
  score: { fontFamily: fonts.display, fontSize: 40, lineHeight: 46, color: colors.ink },
  to: { marginBottom: 14 },
  chips: { flexDirection: 'row', gap: 10, marginVertical: 12 },
  chip: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingVertical: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.surface,
    gap: 2,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
});
