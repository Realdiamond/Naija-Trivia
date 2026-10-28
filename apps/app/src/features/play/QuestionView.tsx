/** The question screen (mockups 02 and 11), driven by useQuestionFlow. */
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { errorMessage } from '../../api';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { CategoryPill, OptionButton, ProgressSegments, TimerBar, type OptionState } from '../../ui/game';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { category, colors, radius } from '../../ui/theme';
import type { QuestionFlow } from './useQuestionFlow';

interface Props {
  flow: QuestionFlow;
  /** Small caps over the counter, e.g. "Taste test" or "Round 2 of 3 · vs Ngozi". */
  overline: string;
  /** The button after the last question; "See my result" by default. */
  finishLabel?: string;
}

export function QuestionView({ flow, overline, finishLabel }: Props) {
  const t = useT();
  const { phase, question, chosen, result, seq, total } = flow;
  const done = phase === 'revealed' || phase === 'finished' ? seq : seq - 1;
  const band = question ? category(question.category_id).color : colors.primary;

  const stateOf = (index: number): OptionState => {
    if (!result) return chosen === index ? 'chosen' : 'idle';
    if (index === result.correct_display_index) return 'correct';
    if (index === chosen) return 'wrong';
    return 'faded';
  };

  const footer =
    phase === 'revealed' ? (
      <Button
        label={seq >= total ? (finishLabel ?? t('question.finish')) : t('question.next')}
        trailingIcon="arrow-right"
        onPress={flow.next}
        testID="next"
      />
    ) : phase === 'error' ? (
      <Button label={t('question.retry')} onPress={flow.retry} testID="retry" />
    ) : (
      <Text variant="bodySoft" align="center">
        {t('question.hint')}
      </Text>
    );

  return (
    <View style={styles.root}>
      <View style={[styles.band, { backgroundColor: band }]} />
      <Screen footer={footer}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text variant="overline">{overline}</Text>
            <Text variant="heading">{t('question.counter', { seq, total })}</Text>
          </View>
          {question ? <CategoryPill id={question.category_id} /> : null}
        </View>
        <ProgressSegments total={total} done={done} />

        {!question && phase === 'loading' ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} size="large" />
        ) : null}

        {question ? (
          <View style={styles.body}>
            <Text variant="title" accessibilityRole="header" testID="question-text">
              {question.text}
            </Text>
            <TimerBar remainingMs={flow.remainingMs} limitMs={question.time_limit_ms} />
            <View style={styles.options}>
              {question.options.map((option, index) => (
                <OptionButton
                  key={`${question.qid}-${index}`}
                  index={index}
                  text={option}
                  state={stateOf(index)}
                  disabled={phase !== 'asking'}
                  onPress={() => flow.submit(index)}
                />
              ))}
            </View>
            {result ? <Reveal flow={flow} /> : null}
          </View>
        ) : null}

        {phase === 'error' ? (
          <Text variant="body" color={colors.wrongInk} align="center" accessibilityLiveRegion="polite">
            {errorMessage(flow.error, t('error.network'))}
          </Text>
        ) : null}
      </Screen>
    </View>
  );
}

function Reveal({ flow }: { flow: QuestionFlow }) {
  const t = useT();
  const result = flow.result!;
  const headline = result.correct
    ? t('question.correct', { points: result.points })
    : flow.chosen === null
      ? t('question.timeUp')
      : t('question.wrong');
  return (
    <View
      style={[styles.reveal, { backgroundColor: result.correct ? colors.correctTint : colors.wrongTint }]}
      accessibilityLiveRegion="polite"
      testID="reveal"
    >
      <Text variant="heading" color={result.correct ? colors.correctInk : colors.wrongInk}>
        {headline}
      </Text>
      {result.fact ? (
        <Text variant="bodySoft" color={colors.ink}>
          <Text variant="label">{t('question.didYouKnow')} </Text>
          {result.fact}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  band: { height: 6 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  headerText: { gap: 2, flexShrink: 1 },
  loading: { marginTop: 64 },
  body: { gap: 20, marginTop: 24 },
  options: { gap: 12 },
  reveal: { borderRadius: radius.card, padding: 16, gap: 6 },
});
