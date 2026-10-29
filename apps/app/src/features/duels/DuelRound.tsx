/** Playing one round of a duel: three questions with the shared question screen (mockup 11). */
import { useCallback, useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { QUESTIONS_PER_ROUND } from '@whosabi/game-rules';
import type { AnswerRequest, DuelView } from '@whosabi/shared-types';
import { useT } from '../../i18n';
import { QuestionView } from '../play/QuestionView';
import { useQuestionFlow } from '../play/useQuestionFlow';
import { duels } from './api';
import { LifelineRow } from './Lifelines';
import { useOpponentName } from './parts';

interface Props {
  duel: DuelView;
  round: number;
  /** Where to pick up: a turn can be left and resumed. */
  firstSeq: number;
  onDone: () => void;
}

export function DuelRound({ duel, round, firstSeq, onDone }: Props) {
  const t = useT();
  const name = useOpponentName(duel);
  const id = duel.id;
  const serve = useCallback((seq: number) => duels.serve(id, round, seq), [id, round]);
  const answer = useCallback(
    (seq: number, body: AnswerRequest) => duels.answer(id, round, seq, body),
    [id, round],
  );
  const flow = useQuestionFlow({ total: QUESTIONS_PER_ROUND, serve, answer, firstSeq });

  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    if (flow.phase === 'finished') done.current();
  }, [flow.phase]);

  return (
    <QuestionView
      flow={flow}
      overline={t('duel.roundOverline', { round, name })}
      finishLabel={t('duel.continue')}
      onLeave={() => router.replace('/home')}
      lifelines={<LifelineRow duelId={id} round={round} flow={flow} />}
    />
  );
}
