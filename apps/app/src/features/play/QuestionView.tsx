/**
 * The question screen (mockups 02, 11 and 30), driven by useQuestionFlow. On computers the keys
 * play too: 1–4 or A–D answer, Enter continues, Esc asks to leave (FR-WEB-5).
 */
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { errorMessage } from '../../api';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { CategoryPill, OptionButton, ProgressSegments, TimerBar, type OptionState } from '../../ui/game';
import { Icon } from '../../ui/icons';
import { useIsDesktop } from '../../ui/layout';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { category, colors, radius } from '../../ui/theme';
import { optionForKey, useKeys } from './keys';
import { ReportSheet } from './ReportSheet';
import type { QuestionFlow } from './useQuestionFlow';

interface Props {
  flow: QuestionFlow;
  /** Small caps over the counter, e.g. "Taste test" or "Round 2 of 3 · vs Ngozi". */
  overline: string;
  /** The button after the last question; "See my result" by default. */
  finishLabel?: string;
  /** Leaving mid-round, after the player confirms. */
  onLeave: () => void;
  /** Duels: the lifeline row under the options (mockup 11, step 2.4b). */
  lifelines?: ReactNode;
}

export function QuestionView({ flow, overline, finishLabel, onLeave, lifelines }: Props) {
  const t = useT();
  const desktop = useIsDesktop();
  const [leaving, setLeaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const { phase, question, chosen, result, seq, total } = flow;

  useKeys((key) => {
    // The report sheet has its own text field: no game keys while it is open.
    if (reporting) return false;
    if (key === 'Escape') {
      setLeaving((open) => !open);
      return true;
    }
    if (leaving) return false;
    const option = optionForKey(key);
    if (
      option !== null &&
      phase === 'asking' &&
      question &&
      option < question.options.length &&
      !question.lifelines?.removed?.includes(option)
    ) {
      flow.submit(option);
      return true;
    }
    if (key === 'Enter' && phase === 'revealed') {
      flow.next();
      return true;
    }
    if (key === 'Enter' && phase === 'error') {
      flow.retry();
      return true;
    }
    return false;
  });
  const done = phase === 'revealed' || phase === 'finished' ? seq : seq - 1;
  const band = question ? category(question.category_id).color : colors.primary;

  // 50/50 takes two options away; Ask Naija shows how players answered.
  const removed = question?.lifelines?.removed ?? [];
  const shares = question?.lifelines?.ask_naija ?? null;
  const stateOf = (index: number): OptionState => {
    if (!result) return chosen === index ? 'chosen' : removed.includes(index) ? 'faded' : 'idle';
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
        {desktop ? t('question.keysHint') : t('question.hint')}
      </Text>
    );

  return (
    <View style={styles.root}>
      <View style={[styles.band, { backgroundColor: band }]} />
      <Screen footer={footer}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('question.leave')}
            hitSlop={12}
            onPress={() => setLeaving(true)}
            style={styles.leave}
            testID="leave"
          >
            <Icon name="back" size={26} />
          </Pressable>
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
                  disabled={phase !== 'asking' || removed.includes(index)}
                  onPress={() => flow.submit(index)}
                  keyHint={desktop}
                  share={!result && shares ? (shares[index] ?? null) : null}
                />
              ))}
            </View>
            {phase === 'asking' || phase === 'sending' ? lifelines : null}
            {result ? <Reveal flow={flow} onReport={() => setReporting(true)} /> : null}
          </View>
        ) : null}

        {phase === 'error' ? (
          <Text variant="body" color={colors.wrongInk} align="center" accessibilityLiveRegion="polite">
            {errorMessage(flow.error, t('error.network'))}
          </Text>
        ) : null}
      </Screen>
      {question ? (
        <ReportSheet
          visible={reporting}
          qid={question.qid}
          text={question.text}
          onClose={() => setReporting(false)}
        />
      ) : null}
      <Dialog
        visible={leaving}
        title={t('question.leaveTitle')}
        body={t('question.leaveBody')}
        confirmLabel={t('question.leave')}
        cancelLabel={t('question.stay')}
        onConfirm={() => {
          setLeaving(false);
          onLeave();
        }}
        onCancel={() => setLeaving(false)}
        testID="leave-dialog"
      />
    </View>
  );
}

function Reveal({ flow, onReport }: { flow: QuestionFlow; onReport: () => void }) {
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
      <Pressable
        accessibilityRole="button"
        onPress={onReport}
        hitSlop={8}
        style={styles.report}
        testID="report-question"
      >
        <Text variant="caption" color={colors.inkSoft} style={styles.reportText}>
          {t('report.link')}
        </Text>
      </Pressable>
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
  headerText: { gap: 2, flexShrink: 1, flexGrow: 1 },
  leave: { width: 32, height: 44, justifyContent: 'center', marginLeft: -6 },
  loading: { marginTop: 64 },
  body: { gap: 20, marginTop: 24 },
  options: { gap: 12 },
  reveal: { borderRadius: radius.card, padding: 16, gap: 6 },
  report: { alignSelf: 'flex-start', marginTop: 4 },
  reportText: { textDecorationLine: 'underline' },
});
