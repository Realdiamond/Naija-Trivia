/**
 * The tie-break (GDD §2.1): one closest-number question for both players. The nearest guess
 * wins; if both are as near, the faster answer does.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { DuelView, ServedQuestion, TiebreakAnswerResponse } from '@whosabi/shared-types';
import { errorMessage } from '../../api';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { TimerBar } from '../../ui/game';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';
import { duels } from './api';
import { useOpponentName } from './parts';

interface Props {
  duel: DuelView;
  /** Called once the answer is in, to load the duel again. */
  onAnswered: () => void;
}

export function Tiebreak({ duel, onAnswered }: Props) {
  const t = useT();
  const name = useOpponentName(duel);
  const [question, setQuestion] = useState<ServedQuestion | null>(null);
  const [guess, setGuess] = useState('');
  const [remainingMs, setRemainingMs] = useState(0);
  const [result, setResult] = useState<TiebreakAnswerResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(0);
  const sent = useRef(false);

  const serve = useCallback(async () => {
    setError(null);
    try {
      const q = await duels.serve(duel.id, 4, 1);
      shownAt.current = Date.now();
      setRemainingMs(q.time_limit_ms);
      setQuestion(q);
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
    }
  }, [duel.id, t]);

  useEffect(() => {
    void serve();
    // Serve once on opening; "Try again" serves again.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(
    async (value: number | null) => {
      if (!question || sent.current) return;
      sent.current = true;
      setBusy(true);
      setError(null);
      try {
        setResult(
          await duels.tiebreakAnswer(duel.id, {
            guess: value,
            client_elapsed_ms: Math.min(Date.now() - shownAt.current, question.time_limit_ms),
          }),
        );
      } catch (e) {
        sent.current = false;
        setError(errorMessage(e, t('error.network')));
      } finally {
        setBusy(false);
      }
    },
    [duel.id, question, t],
  );

  useEffect(() => {
    if (!question || result) return;
    const timer = setInterval(() => {
      const left = question.time_limit_ms - (Date.now() - shownAt.current);
      setRemainingMs(Math.max(0, left));
      if (left <= 0) void submit(null);
    }, 100);
    return () => clearInterval(timer);
  }, [question, result, submit]);

  const parsed = Number(guess.replace(/[,\s]/g, ''));
  const valid = guess.trim() !== '' && Number.isFinite(parsed);

  return (
    <Screen
      footer={
        result ? (
          <Button
            label={result.decided ? t('duel.seeResult') : t('duel.home')}
            onPress={onAnswered}
            testID="tiebreak-done"
          />
        ) : question ? (
          <Button
            label={t('duel.lockIn')}
            loading={busy}
            disabled={!valid}
            onPress={() => void submit(parsed)}
            testID="tiebreak-submit"
          />
        ) : error ? (
          <Button label={t('question.retry')} onPress={() => void serve()} />
        ) : null
      }
    >
      <Text variant="overline">{t('duel.tiebreakOverline')}</Text>
      <Text variant="heading">{t('duel.vs', { name })}</Text>
      {!question && !error ? <ActivityIndicator style={styles.loading} color={colors.primary} /> : null}
      {question ? (
        <View style={styles.body}>
          <Text variant="title" accessibilityRole="header" testID="question-text">
            {question.text}
          </Text>
          <TimerBar remainingMs={remainingMs} limitMs={question.time_limit_ms} />
          {result ? (
            <View style={styles.reveal} accessibilityLiveRegion="polite" testID="tiebreak-result">
              <Text variant="heading">
                {t('duel.answerWas', { answer: result.answer.toLocaleString('en-NG') })}
              </Text>
              <Text variant="body">
                {t('duel.yourGuessWas', {
                  guess: result.guess === null ? '—' : result.guess.toLocaleString('en-NG'),
                })}
              </Text>
              {result.fact ? <Text variant="bodySoft">{result.fact}</Text> : null}
              {!result.decided ? <Text variant="body">{t('duel.tiebreakWait', { name })}</Text> : null}
            </View>
          ) : (
            <>
              <Field
                label={t('duel.yourGuess')}
                value={guess}
                onChangeText={setGuess}
                keyboardType="numeric"
                inputMode="decimal"
                autoFocus
                onSubmitEditing={() => valid && void submit(parsed)}
                testID="tiebreak-guess"
              />
              <Text variant="caption">{t('duel.tiebreakHint')}</Text>
            </>
          )}
        </View>
      ) : null}
      {error ? (
        <Text variant="body" color={colors.wrongInk} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 48 },
  body: { gap: 20, marginTop: 24 },
  reveal: { gap: 8, padding: 16, borderRadius: radius.card, backgroundColor: colors.primaryTint },
});
