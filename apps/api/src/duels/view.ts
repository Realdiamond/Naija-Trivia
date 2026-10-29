/**
 * A duel as one player sees it. The rule that keeps duels fair: questions, answers and the
 * opponent's points for a round are only shown once you have finished that round yourself.
 * Correct answers are only ever shown for rounds you have played.
 */
import {
  categoryPicker,
  displayOrder,
  isFinished,
  optionPermutation,
  roundsForTurn,
  shuffleSeed,
  TIEBREAK_ROUND,
  toDisplayIndex,
  turnSide,
  type DuelSide,
} from '@whosabi/game-rules';
import type {
  DuelNextAction,
  DuelPlayer,
  DuelResult,
  DuelRoundView,
  DuelSummary,
  DuelView,
  GameReward,
  ReviewQuestion,
  RoundProgress,
  TiebreakView,
} from '@whosabi/shared-types';
import type { DuelQuestion } from './questions';
import {
  playerFor,
  roundFinished,
  sideOf,
  type AnswerRow,
  type DuelRow,
  type PlayerRow,
  type RoundRow,
} from './repo';

export interface DuelData {
  duel: DuelRow;
  rounds: RoundRow[];
  answers: AnswerRow[];
  players: Map<string, PlayerRow>;
}

/** What the player should do next; null once the duel is over. */
export function nextAction(data: DuelData, viewer: string): DuelNextAction | null {
  const { duel, rounds, answers } = data;
  const side = sideOf(duel, viewer);
  if (side === null || isFinished(duel.state)) return null;
  if (duel.state === 'tiebreak') {
    const answered = answers.some(
      (a) => a.round_no === TIEBREAK_ROUND && a.user_id === viewer && a.received_at !== null,
    );
    return answered ? { action: 'wait' } : { action: 'tiebreak' };
  }
  if (turnSide(duel.state) !== side) return { action: 'wait' };
  for (const roundNo of roundsForTurn(duel.state)) {
    const round = rounds.find((r) => r.round_no === roundNo);
    if (!round) return { action: 'wait' };
    if (round.category_id === null) {
      return categoryPicker(roundNo) === side
        ? { action: 'pick_category', round: roundNo, offered: round.offered }
        : { action: 'wait' };
    }
    const answered = answers.filter(
      (a) => a.user_id === viewer && a.round_no === roundNo && a.received_at !== null,
    ).length;
    if (answered < round.question_ids.length) return { action: 'play', round: roundNo, seq: answered + 1 };
  }
  return { action: 'wait' };
}

export function buildSummary(data: DuelData, viewer: string): DuelSummary {
  const { duel, rounds, answers, players } = data;
  const side = sideOf(duel, viewer)!;
  const opponentId = playerFor(duel, side === 'a' ? 'b' : 'a');
  const finished = isFinished(duel.state);
  const next = nextAction(data, viewer);

  let you = 0;
  let opponent = 0;
  for (const round of rounds.filter((r) => r.round_no <= 3)) {
    you += progress(answers, viewer, round.round_no).points;
    // The opponent's points count once you have finished the round (or the duel is over).
    if (opponentId && (finished || roundFinished(round, answers, viewer))) {
      opponent += progress(answers, opponentId, round.round_no).points;
    }
  }

  return {
    id: duel.id,
    state: duel.state,
    source: duel.source,
    you: side,
    opponent: opponentId ? player(players.get(opponentId), opponentId) : null,
    your_turn: next !== null && next.action !== 'wait',
    turn_deadline: finished ? null : iso(duel.turn_deadline),
    score: { you, opponent },
    result: resultFor(duel, side),
    rating_delta: side === 'a' ? duel.rating_delta_a : duel.rating_delta_b,
    reward: rewardFor(duel, side),
    created_at: duel.created_at.toISOString(),
    completed_at: iso(duel.completed_at),
  };
}

export function buildView(
  data: DuelData,
  viewer: string,
  questions: Map<string, DuelQuestion>,
  publicWebUrl: string,
): DuelView {
  const { duel, rounds, answers } = data;
  const summary = buildSummary(data, viewer);
  const opponentId = playerFor(duel, summary.you === 'a' ? 'b' : 'a');

  const roundViews: DuelRoundView[] = [1, 2, 3].map((roundNo) => {
    const round = rounds.find((r) => r.round_no === roundNo);
    const finishedByYou = roundFinished(round, answers, viewer);
    return {
      round: roundNo,
      category_id: round?.category_id ?? null,
      picked_by: !round?.picked_by ? null : round.picked_by === viewer ? 'you' : 'opponent',
      you: progress(answers, viewer, roundNo),
      opponent: finishedByYou && opponentId ? progress(answers, opponentId, roundNo) : null,
      questions:
        finishedByYou && round ? review(duel.id, round, answers, viewer, opponentId, questions) : null,
    };
  });

  const openInvite =
    summary.you === 'a' && duel.player_b === null && duel.invite_token !== null && !isFinished(duel.state);
  return {
    ...summary,
    invite_url: openInvite ? inviteUrl(publicWebUrl, duel.invite_token!) : null,
    next: nextAction(data, viewer),
    rounds: roundViews,
    tiebreak: tiebreakView(rounds, answers, viewer, opponentId, questions),
  };
}

export const inviteUrl = (publicWebUrl: string, token: string) => `${publicWebUrl}/d/${token}`;

/** Question ids whose text a viewer may see: rounds they finished, plus the tie-break. */
export function visibleQuestionIds(data: DuelData, viewer: string): string[] {
  const rounds = data.rounds.filter(
    (r) => r.round_no === TIEBREAK_ROUND || roundFinished(r, data.answers, viewer),
  );
  // A question Skip swapped in (step 2.4b) is the viewer's own.
  const swapped = data.answers
    .filter((a) => a.user_id === viewer && rounds.some((r) => r.round_no === a.round_no))
    .map((a) => a.question_id);
  return [...new Set([...rounds.flatMap((r) => r.question_ids), ...swapped])];
}

function rewardFor(duel: DuelRow, side: DuelSide): GameReward | null {
  const xp = side === 'a' ? duel.xp_a : duel.xp_b;
  if (xp === null) return null;
  return { coins: (side === 'a' ? duel.coins_a : duel.coins_b) ?? 0, xp };
}

export function resultFor(duel: DuelRow, side: DuelSide): DuelResult | null {
  if (duel.state !== 'complete' && duel.state !== 'forfeit') return null;
  if (duel.winner_id === null) return 'draw';
  return duel.winner_id === playerFor(duel, side) ? 'win' : 'loss';
}

function progress(answers: readonly AnswerRow[], userId: string, roundNo: number): RoundProgress {
  const rows = answers.filter(
    (a) => a.user_id === userId && a.round_no === roundNo && a.received_at !== null,
  );
  return {
    answered: rows.length,
    correct: rows.filter((a) => a.correct).length,
    points: rows.reduce((sum, a) => sum + a.points, 0),
  };
}

function review(
  duelId: string,
  round: RoundRow,
  answers: readonly AnswerRow[],
  viewer: string,
  opponentId: string | null,
  questions: Map<string, DuelQuestion>,
): ReviewQuestion[] {
  return round.question_ids.flatMap((roundQid, i) => {
    const seq = i + 1;
    const mine = answers.find((a) => a.round_no === round.round_no && a.seq === seq && a.user_id === viewer);
    const theirs = answers.find(
      (a) => a.round_no === round.round_no && a.seq === seq && a.user_id === opponentId,
    );
    // After Skip, the viewer's question at this place is the one swapped in.
    const qid = mine?.question_id ?? roundQid;
    const q = questions.get(qid);
    if (!q || q.correct_index === null) return [];
    const perm = optionPermutation(q.options.length, shuffleSeed(duelId, viewer, qid));
    return [
      {
        seq,
        qid,
        text: q.text,
        options: displayOrder(q.options, perm),
        correct_display_index: toDisplayIndex(perm, q.correct_index),
        your_display_index: mine?.display_index ?? null,
        your_points: mine?.points ?? 0,
        // Only comparable when both played the same question.
        opponent_correct: theirs?.received_at && theirs.question_id === qid ? Boolean(theirs.correct) : null,
        fact: q.fact,
      },
    ];
  });
}

function tiebreakView(
  rounds: readonly RoundRow[],
  answers: readonly AnswerRow[],
  viewer: string,
  opponentId: string | null,
  questions: Map<string, DuelQuestion>,
): TiebreakView | null {
  const round = rounds.find((r) => r.round_no === TIEBREAK_ROUND);
  const q = round ? questions.get(round.question_ids[0]!) : undefined;
  if (!round || !q) return null;
  const answerOf = (userId: string | null) =>
    answers.find((a) => a.round_no === TIEBREAK_ROUND && a.user_id === userId && a.received_at !== null);
  const mine = answerOf(viewer);
  const theirs = answerOf(opponentId);
  return {
    text: q.text,
    your_guess: mine?.guess ?? null,
    answered: Boolean(mine),
    opponent_answered: Boolean(theirs),
    answer: mine ? q.numeric_answer : null,
    opponent_guess: mine && theirs ? theirs.guess : null,
  };
}

function player(row: PlayerRow | undefined, id: string): DuelPlayer {
  return { id, username: row?.username ?? null, level: row?.level ?? 1 };
}

const iso = (d: Date | null) => (d === null ? null : d.toISOString());
