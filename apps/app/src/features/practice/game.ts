/**
 * A practice game played on the device (GDD §2.6, build plan step 2.8g): the set's questions
 * carry their answers, so serving and checking happen here, with the same option shuffle and
 * scoring as duels. No React Native in here, so the rules are unit-tested.
 */
import {
  displayOrder,
  optionPermutation,
  scoreAnswer,
  shuffleSeed,
  toCanonicalIndex,
  toDisplayIndex,
} from '@whosabi/game-rules';
import type {
  AnswerRequest,
  AnswerResponse,
  PracticeAnswer,
  PracticeQuestion,
  PracticeResultRequest,
  ServedQuestion,
} from '@whosabi/shared-types';

export interface LocalGame {
  /** Made on the device; the server pays a game once by it. */
  id: string;
  packId: string;
  week: string;
  questions: PracticeQuestion[];
  timeLimitMs: number;
  userId: string;
}

/** Plays one game: serve shuffles each question's options, answer checks and scores the tap. */
export function localGame(game: LocalGame, now: () => number = Date.now) {
  const answers: PracticeAnswer[] = [];
  let streak = 0;
  let score = 0;
  const perm = (q: PracticeQuestion) =>
    optionPermutation(q.options.length, shuffleSeed(game.id, game.userId, q.qid));

  return {
    total: game.questions.length,
    answers,
    serve(seq: number): ServedQuestion {
      const q = game.questions[seq - 1];
      if (!q) throw new RangeError(`no question ${seq}`);
      return {
        qid: q.qid,
        seq,
        total: game.questions.length,
        type: q.type,
        category_id: q.category_id,
        text: q.text,
        options: displayOrder(q.options, perm(q)),
        media: null,
        time_limit_ms: game.timeLimitMs,
        served_at: new Date(now()).toISOString(),
      };
    },
    answer(seq: number, body: AnswerRequest): AnswerResponse {
      const q = game.questions[seq - 1];
      if (!q) throw new RangeError(`no question ${seq}`);
      const order = perm(q);
      const picked = body.display_index === null ? null : toCanonicalIndex(order, body.display_index);
      const elapsed = Math.min(body.client_elapsed_ms ?? game.timeLimitMs, game.timeLimitMs);
      const correct = picked === q.correct_index;
      const scored = scoreAnswer({
        correct,
        elapsedMs: elapsed,
        timeLimitMs: game.timeLimitMs,
        streakBefore: streak,
      });
      // Answering the same question again (a retry) changes nothing.
      if (!answers.some((a) => a.qid === q.qid)) {
        answers.push({ qid: q.qid, picked, elapsed_ms: Math.round(elapsed) });
        streak = scored.streakAfter;
        score += scored.points;
      }
      return {
        correct,
        timed_out: body.display_index === null,
        correct_display_index: toDisplayIndex(order, q.correct_index),
        points: scored.points,
        breakdown: { base: scored.base, speed: scored.speed, streak: scored.streak },
        fact: q.fact,
        running_score: score,
        streak,
      };
    },
    /** What the server is sent once the game ends (or is left part way). */
    result(playedAt: number): PracticeResultRequest {
      return {
        id: game.id,
        pack_id: game.packId,
        week: game.week,
        played_at: new Date(playedAt).toISOString(),
        answers: [...answers],
        complete: answers.length === game.questions.length,
      };
    },
    correctCount(): number {
      return answers.filter((a) => {
        const q = game.questions.find((x) => x.qid === a.qid);
        return q !== undefined && a.picked === q.correct_index;
      }).length;
    },
  };
}

/**
 * Whether a result that failed to send should wait for another try: yes when the network or the
 * server failed, or we were asked to slow down; no when the server turned it down for good.
 */
export function keepForRetry(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return true;
  return status >= 500 || status === 401 || status === 408 || status === 429;
}
