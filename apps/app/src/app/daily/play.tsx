/**
 * Playing today's Daily (PRD US-8): the 7 questions on the shared question screen, picking up
 * where the player stopped, then the result. Played already: straight to the result.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { AnswerRequest, DailyToday } from '@whosabi/shared-types';
import { ApiError, errorMessage } from '../../api';
import { useSession } from '../../auth/session';
import { daily, dailyKeys, useDailyToday } from '../../features/daily/api';
import { QuestionView } from '../../features/play/QuestionView';
import { sampleRtt } from '../../features/play/rtt';
import { useQuestionFlow } from '../../features/play/useQuestionFlow';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors } from '../../ui/theme';

export default function DailyPlay() {
  const t = useT();
  const status = useSession((s) => s.status);
  const signedIn = status === 'guest' || status === 'account';
  const today = useDailyToday(signedIn);
  const [ready, setReady] = useState(false);
  const data = today.data;
  const finished = Boolean(data && (data.played || data.answered >= data.total));

  useEffect(() => {
    if (data && finished) router.replace(`/daily/${data.id}`);
  }, [data, finished]);

  useEffect(() => {
    // One round-trip sample first, so the server can time the answers fairly (TRD §5.3).
    if (data && !finished && !ready) void sampleRtt().finally(() => setReady(true));
  }, [data, finished, ready]);

  if (status === 'signed_out') return <Redirect href="/welcome" />;

  if (today.isError) {
    const notReady = today.error instanceof ApiError && today.error.status === 503;
    return (
      <Screen back backTo="/home">
        <View style={styles.center}>
          <Text variant="heading" align="center">
            {notReady ? t('daily.notReady') : errorMessage(today.error, t('error.network'))}
          </Text>
          <Button label={t('error.retry')} onPress={() => void today.refetch()} />
        </View>
      </Screen>
    );
  }

  if (!data || finished || !ready) {
    return (
      <Screen>
        <ActivityIndicator style={styles.loading} color={colors.primary} size="large" />
      </Screen>
    );
  }
  return <DailyQuestions today={data} />;
}

/** Mounted once today's Daily is known, so the flow starts at the right question. */
function DailyQuestions({ today }: { today: DailyToday }) {
  const t = useT();
  const queryClient = useQueryClient();
  const serve = useCallback((seq: number) => daily.serve(today.id, seq), [today.id]);
  const answer = useCallback(
    (seq: number, body: AnswerRequest) => daily.answer(today.id, seq, body),
    [today.id],
  );
  const flow = useQuestionFlow({ total: today.total, serve, answer, firstSeq: today.answered + 1 });

  useEffect(() => {
    if (flow.phase !== 'finished') return;
    void queryClient.invalidateQueries({ queryKey: dailyKeys.all });
    router.replace(`/daily/${today.id}`);
  }, [flow.phase, queryClient, today.id]);

  return (
    <QuestionView
      flow={flow}
      overline={t('daily.overline', { id: today.id })}
      onLeave={() => {
        void queryClient.invalidateQueries({ queryKey: dailyKeys.today });
        router.replace('/home');
      }}
    />
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 80 },
  center: { flex: 1, justifyContent: 'center', gap: 20 },
});
