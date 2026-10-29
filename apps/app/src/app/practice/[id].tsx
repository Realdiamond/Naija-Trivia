/**
 * Practising a pack (GDD §2.6, build plan step 2.8g): 10 questions from its practice set, the
 * ones played least first, answered and checked on this device, so it works offline. Online, the
 * week's set is fetched and saved first. The finished game is kept and sent when there's
 * network; it pays XP (never rating).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { nextPracticeGame } from '@whosabi/game-rules';
import type { AnswerRequest, PracticeResultResponse, PracticeSet } from '@whosabi/shared-types';
import { ApiError } from '../../api';
import { useSession } from '../../auth/session';
import { practice, practiceKeys, usePacks } from '../../features/practice/api';
import { localGame } from '../../features/practice/game';
import { loadPractice, recordGame, savePack, sendQueued, usePractice } from '../../features/practice/store';
import { QuestionView } from '../../features/play/QuestionView';
import { useQuestionFlow } from '../../features/play/useQuestionFlow';
import { useT } from '../../i18n';
import { randomUuid } from '../../platform/random';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors, fonts } from '../../ui/theme';

/** Back to the packs screen the player came from, or to a fresh one (a link opened directly). */
const toPacks = () => (router.canGoBack() ? router.back() : router.replace('/practice'));

export default function PracticePack() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, user } = useSession();
  const online = status === 'guest' || status === 'account';
  const loaded = usePractice((s) => s.loaded);
  const saved = usePractice((s) => s.packs[id]);
  const packs = usePacks(online);
  const summary = packs.data?.packs.find((p) => p.id === id) ?? saved?.pack;
  const fresh = useQuery({
    queryKey: practiceKeys.set(id),
    queryFn: () => practice.set(id),
    enabled: online,
    retry: false,
    staleTime: Infinity,
  });
  const [round, setRound] = useState(0);

  useEffect(() => {
    void loadPractice();
  }, []);
  useEffect(() => {
    if (fresh.data && summary) savePack(summary, fresh.data);
  }, [fresh.data, summary]);

  if (status === 'signed_out') return <Redirect href="/welcome" />;

  // Online, wait for this week's set (or for the network to fail, then play the saved one).
  const settling = status === 'loading' || !loaded || (online && fresh.isLoading);
  const set = fresh.data ?? saved?.set;
  if (settling) {
    return (
      <Screen>
        <ActivityIndicator style={styles.loading} color={colors.primary} size="large" />
      </Screen>
    );
  }
  if (!set || set.questions.length === 0) {
    const locked = fresh.error instanceof ApiError && fresh.error.code === 'PACK_LOCKED' ? fresh.error : null;
    return (
      <Screen back backTo="/practice">
        <View style={styles.center}>
          <Text variant="heading" align="center">
            {locked ? locked.message : t('practice.needNetwork')}
          </Text>
          <Button label={t('practice.backToPacks')} onPress={() => toPacks()} />
        </View>
      </Screen>
    );
  }
  return (
    <PracticeGame
      key={`${set.week}:${round}`}
      set={set}
      title={summary?.title ?? ''}
      userId={user?.id ?? ''}
      onAgain={() => setRound((r) => r + 1)}
    />
  );
}

interface Outcome {
  correct: number;
  total: number;
  sending: boolean;
  paid: PracticeResultResponse | null;
}

function PracticeGame({
  set,
  title,
  userId,
  onAgain,
}: {
  set: PracticeSet;
  title: string;
  userId: string;
  onAgain: () => void;
}) {
  const t = useT();
  const [game] = useState(() => {
    const ids = nextPracticeGame(
      set.questions.map((q) => q.qid),
      usePractice.getState().plays,
    );
    return localGame({
      id: randomUuid(),
      packId: set.pack_id,
      week: set.week,
      questions: ids.map((qid) => set.questions.find((q) => q.qid === qid)!),
      timeLimitMs: set.time_limit_ms,
      userId,
    });
  });
  const serve = useCallback(async (seq: number) => game.serve(seq), [game]);
  const answer = useCallback(async (seq: number, body: AnswerRequest) => game.answer(seq, body), [game]);
  const flow = useQuestionFlow({ total: game.total, serve, answer });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const recorded = useRef(false);

  /** Keeps the game (finished, or left part way with answers) and sends it if it can. */
  const record = useCallback(() => {
    if (recorded.current || game.answers.length === 0) return null;
    recorded.current = true;
    const result = game.result(Date.now());
    recordGame(result);
    return result;
  }, [game]);

  useEffect(() => {
    if (flow.phase !== 'finished') return;
    const result = record();
    setOutcome({ correct: game.correctCount(), total: game.total, sending: true, paid: null });
    void sendQueued().then((paid) =>
      setOutcome((o) => o && { ...o, sending: false, paid: (result && paid.get(result.id)) ?? null }),
    );
  }, [flow.phase, game, record]);

  if (outcome) {
    return (
      <Screen>
        <View style={styles.hero}>
          <View style={styles.circle} testID="practice-score">
            <Text style={styles.circleScore} color={colors.white}>
              {outcome.correct}/{outcome.total}
            </Text>
          </View>
          <Text variant="display" align="center" accessibilityRole="header">
            {t('practice.done', { correct: outcome.correct, total: outcome.total })}
          </Text>
          {outcome.sending ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text variant="heading" align="center" color={colors.primaryInk} testID="practice-xp">
              {outcome.paid
                ? outcome.paid.capped
                  ? t('practice.xpCapped', { xp: outcome.paid.xp })
                  : t('practice.xp', { xp: outcome.paid.xp })
                : t('practice.xpLater')}
            </Text>
          )}
        </View>
        <View style={styles.buttons}>
          <Button label={t('practice.playAgain')} onPress={onAgain} testID="practice-again" />
          <Button
            label={t('practice.backToPacks')}
            variant="outline"
            onPress={() => toPacks()}
            testID="practice-back"
          />
        </View>
      </Screen>
    );
  }
  return (
    <QuestionView
      flow={flow}
      overline={t('practice.overline', { title })}
      onLeave={() => {
        if (record()) void sendQueued();
        toPacks();
      }}
    />
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 80 },
  center: { flex: 1, justifyContent: 'center', gap: 20, marginTop: 40 },
  hero: { alignItems: 'center', gap: 14, marginTop: 24 },
  circle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  circleScore: { fontFamily: fonts.display, fontSize: 44, lineHeight: 50 },
  buttons: { gap: 12, marginTop: 32 },
});
