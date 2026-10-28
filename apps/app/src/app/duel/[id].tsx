/**
 * One duel, from start to result. The server says what to do next (`next` in the duel view):
 * pick a category, play a round, answer the tie-break or wait; after each round the player
 * sees the review. Opening the same link again picks up exactly where they left off.
 */
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { DuelNextAction, DuelView } from '@whosabi/shared-types';
import { ApiError, errorMessage } from '../../api';
import { useSession } from '../../auth/session';
import { duelKeys, useDuel } from '../../features/duels/api';
import { DuelIntro } from '../../features/duels/DuelIntro';
import { DuelResult } from '../../features/duels/DuelResult';
import { DuelRound } from '../../features/duels/DuelRound';
import { DuelWaiting } from '../../features/duels/DuelWaiting';
import { PickCategory } from '../../features/duels/PickCategory';
import { RoundReview } from '../../features/duels/RoundReview';
import { Tiebreak } from '../../features/duels/Tiebreak';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors } from '../../ui/theme';

export default function DuelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const status = useSession((s) => s.status);
  const signedIn = status === 'guest' || status === 'account';
  if (status === 'signed_out') return <Redirect href="/welcome" />;
  if (!signedIn || !id) return <Loading />;
  return <Duel id={id} />;
}

function Duel({ id }: { id: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  /** The round just finished, shown before moving on; from the result, each round in turn. */
  const [review, setReview] = useState<{ round: number; fromResult: boolean } | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const query = useDuel(id);
  const duel = query.data;

  const reload = () => void queryClient.invalidateQueries({ queryKey: duelKeys.one(id) });

  if (query.isError && !duel) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Screen back backTo="/home">
        <View style={styles.center}>
          <Text variant="heading" align="center">
            {missing ? t('duel.notFound') : errorMessage(query.error, t('error.network'))}
          </Text>
          {missing ? null : <Button label={t('error.retry')} onPress={reload} />}
        </View>
      </Screen>
    );
  }
  if (!duel) return <Loading />;

  if (review) {
    const next = review.fromResult ? null : duel.next;
    return (
      <RoundReview
        duel={duel}
        round={review.round}
        continueLabel={review.fromResult ? t('duel.continue') : continueLabel(next, t)}
        // What comes next is only known once the duel has loaded again after the round.
        busy={!review.fromResult && query.isFetching}
        onContinue={() =>
          setReview(
            review.fromResult && review.round < 3 ? { round: review.round + 1, fromResult: true } : null,
          )
        }
      />
    );
  }

  const next = duel.next;
  if (!next) return <DuelResult duel={duel} onReview={() => setReview({ round: 1, fromResult: true })} />;
  switch (next.action) {
    case 'pick_category':
      return <PickCategory duel={duel} round={next.round} offered={next.offered} />;
    case 'play':
      if (isNewChallenge(duel, next) && !introDone) {
        return <DuelIntro duel={duel} onPlay={() => setIntroDone(true)} />;
      }
      return (
        <DuelRound
          key={`${next.round}`}
          duel={duel}
          round={next.round}
          firstSeq={next.seq}
          onDone={() => {
            setReview({ round: next.round, fromResult: false });
            reload();
          }}
        />
      );
    case 'tiebreak':
      return <Tiebreak duel={duel} onAnswered={reload} />;
    case 'wait':
      return <DuelWaiting duel={duel} />;
  }
}

/** The challenged player opening a duel they have not started: they may still decline. */
function isNewChallenge(duel: DuelView, next: Extract<DuelNextAction, { action: 'play' }>): boolean {
  // A link was accepted on purpose, and a random duel asked for, so those players go straight in.
  const challenged = duel.source === 'friend' || duel.source === 'rematch';
  return duel.you === 'b' && challenged && next.round === 1 && next.seq === 1;
}

function continueLabel(next: DuelNextAction | null, t: ReturnType<typeof useT>): string {
  if (!next) return t('duel.seeResult');
  if (next.action === 'pick_category') return t('duel.pickNext', { round: next.round });
  if (next.action === 'play') return t('duel.playNext', { round: next.round });
  return t('duel.continue');
}

function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', gap: 20 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
