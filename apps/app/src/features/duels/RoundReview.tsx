/** A finished round, question by question (mockup 12): the right answer, both players, the fact. */
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { DuelView, ReviewQuestion } from '@whosabi/shared-types';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { category, colors, radius } from '../../ui/theme';
import { useOpponentName } from './parts';

interface Props {
  duel: DuelView;
  round: number;
  continueLabel: string;
  onContinue: () => void;
  busy?: boolean;
}

export function RoundReview({ duel, round, continueLabel, onContinue, busy = false }: Props) {
  const t = useT();
  const name = useOpponentName(duel);
  const view = duel.rounds[round - 1];
  const c = category(view?.category_id);
  const picker = view?.picked_by === 'opponent' ? t('duel.theirPick', { name }) : t('duel.yourPick');

  return (
    <View style={styles.root}>
      <View style={[styles.band, { backgroundColor: c.color }]} />
      <Screen
        footer={
          <View style={styles.footer}>
            <Text variant="label" style={styles.total}>
              {t('duel.total', { you: duel.score.you, name, opponent: duel.score.opponent })}
            </Text>
            <Button
              label={continueLabel}
              onPress={onContinue}
              loading={busy}
              size="medium"
              testID="review-continue"
            />
          </View>
        }
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text variant="overline">
              {t('duel.roundN', { round })} · {picker}
            </Text>
            <Text variant="display" accessibilityRole="header">
              {c.name}
            </Text>
          </View>
          {view ? (
            <View style={styles.thisRound}>
              <Text variant="caption">{t('duel.thisRound')}</Text>
              <Text variant="heading">
                <Text variant="heading" color={colors.primaryInk}>
                  {view.you.points}
                </Text>
                {view.opponent ? ` ${t('duel.to')} ${view.opponent.points}` : ''}
              </Text>
            </View>
          ) : null}
        </View>

        {view?.questions ? (
          <View style={styles.list} testID="round-review">
            {view.questions.map((q) => (
              <QuestionCard key={q.qid} question={q} name={name} />
            ))}
          </View>
        ) : (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        )}
      </Screen>
    </View>
  );
}

function QuestionCard({ question, name }: { question: ReviewQuestion; name: string }) {
  const t = useT();
  const right = question.options[question.correct_display_index] ?? '';
  const youRight = question.your_display_index === question.correct_display_index;
  const opponent =
    question.opponent_correct === null
      ? { text: t('duel.opponentPending', { name }), bg: colors.sand, fg: colors.muted }
      : question.opponent_correct
        ? { text: t('duel.opponentRight', { name }), bg: colors.correctTint, fg: colors.correctInk }
        : { text: t('duel.opponentWrong', { name }), bg: colors.wrongTint, fg: colors.wrongInk };
  return (
    <View style={styles.card}>
      <Text variant="label" style={styles.question}>
        {question.seq}. {question.text}
      </Text>
      <View style={styles.answer}>
        <Icon name="check" color={colors.correctInk} size={18} strokeWidth={2.5} />
        <Text variant="label" color={colors.correctInk}>
          {right}
        </Text>
      </View>
      <View style={styles.players}>
        <View style={[styles.player, { backgroundColor: youRight ? colors.correctTint : colors.wrongTint }]}>
          <Text variant="label" color={youRight ? colors.correctInk : colors.wrongInk}>
            {youRight ? t('duel.youScored', { points: question.your_points }) : t('duel.youMissed')}
          </Text>
        </View>
        <View style={[styles.player, { backgroundColor: opponent.bg }]}>
          <Text variant="label" color={opponent.fg} numberOfLines={2}>
            {opponent.text}
          </Text>
        </View>
      </View>
      {question.fact ? (
        <Text variant="bodySoft" color={colors.ink}>
          <Text variant="label">{t('question.didYouKnow')} </Text>
          {question.fact}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  band: { height: 6 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  headerText: { flex: 1 },
  thisRound: { alignItems: 'flex-end' },
  list: { gap: 12, marginTop: 16, marginBottom: 8 },
  loading: { marginTop: 48 },
  card: {
    gap: 10,
    padding: 16,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  question: { fontSize: 17, lineHeight: 23 },
  answer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.correctTint,
  },
  players: { flexDirection: 'row', gap: 10 },
  player: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.button },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  total: { flex: 1 },
});
