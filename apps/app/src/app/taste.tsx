/** The first-run taste test (mockup 02): three questions, no sign-up, then the result. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import {
  routes,
  type AnswerRequest,
  type AnswerResponse,
  type ServedQuestion,
  type StartRoundResponse,
} from '@whosabi/shared-types';
import { trackEvent } from '../analytics';
import { api, errorMessage } from '../api';
import { useSession } from '../auth/session';
import { QuestionView } from '../features/play/QuestionView';
import { sampleRtt } from '../features/play/rtt';
import { useQuestionFlow } from '../features/play/useQuestionFlow';
import { useTasteResult } from '../features/taste/store';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';

export default function TasteTest() {
  const t = useT();
  const status = useSession((s) => s.status);
  const [round, setRound] = useState<StartRoundResponse | null>(null);
  const [startError, setStartError] = useState<unknown>(null);
  const startedAt = useRef(Date.now());
  const signedIn = status === 'guest' || status === 'account';

  const start = useCallback(async () => {
    setStartError(null);
    try {
      await sampleRtt();
      setRound(await api.post<StartRoundResponse>(routes.rounds(), { mode: 'taste_test' }));
      startedAt.current = Date.now();
    } catch (e) {
      setStartError(e);
    }
  }, []);

  useEffect(() => {
    if (signedIn && !round) void start();
  }, [signedIn, round, start]);

  const roundId = round?.round_id;
  const serve = useCallback(
    (seq: number) => api.post<ServedQuestion>(routes.serve(roundId!, seq)),
    [roundId],
  );
  const answer = useCallback(
    (seq: number, body: AnswerRequest) => api.post<AnswerResponse>(routes.answer(roundId!, seq), body),
    [roundId],
  );
  const flow = useQuestionFlow({ total: round?.total ?? 3, serve, answer, enabled: Boolean(roundId) });

  useEffect(() => {
    if (flow.phase !== 'finished') return;
    const played = [...flow.played].sort((a, b) => a.question.seq - b.question.seq);
    const correct = played.filter((p) => p.result.correct).length;
    const score = played.at(-1)?.result.running_score ?? 0;
    trackEvent('taste_test_completed', {
      correct_count: correct,
      score,
      duration_ms: Date.now() - startedAt.current,
    });
    useTasteResult.setState({
      summary: {
        correct,
        total: played.length,
        score,
        items: played.map((p) => ({
          categoryId: p.question.category_id,
          line: p.result.fact ?? p.question.text,
          correct: p.result.correct,
          points: p.result.points,
        })),
      },
    });
    router.replace('/taste-result');
  }, [flow.phase, flow.played]);

  if (status === 'signed_out') return <Redirect href="/welcome" />;

  if (startError) {
    return (
      <Screen back backTo="/welcome">
        <View style={styles.error}>
          <Text variant="heading" align="center">
            {errorMessage(startError, t('error.network'))}
          </Text>
          <Button label={t('error.retry')} onPress={() => void start()} />
        </View>
      </Screen>
    );
  }

  return (
    <QuestionView
      flow={flow}
      overline={t('taste.overline')}
      onLeave={() => router.replace(status === 'guest' || status === 'account' ? '/home' : '/welcome')}
    />
  );
}

const styles = StyleSheet.create({
  error: { flex: 1, justifyContent: 'center', gap: 20 },
});
