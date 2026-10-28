/**
 * Serving and answering a solo question, shared by the taste test and the Daily: one question at
 * a time, served time recorded once, per-player option order, scoring from packages/game-rules
 * (TRD §5.1–5.4), and answers kept once so retries and double taps change nothing.
 */
import type { FastifyRequest } from 'fastify';
import {
  acceptElapsed,
  displayOrder,
  optionPermutation,
  scoreAnswer,
  shuffleSeed,
  toCanonicalIndex,
  toDisplayIndex,
} from '@whosabi/game-rules';
import {
  ErrorCode,
  type AnswerRequest,
  type AnswerResponse,
  type ServedQuestion,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { loadQuestion, type QuestionRow } from '../content/questions';
import { recordQuestionStats } from '../content/stats';
import { ApiError, conflict, notFound } from '../errors';
import { requestEventContext } from '../events';
import { rttFor } from '../rtt';
import type { RoundStore, StoredAnswer } from './store';

export interface SoloRound {
  id: string;
  userId: string;
  mode: 'taste_test' | 'daily';
  questionIds: readonly string[];
  timeLimitMs: number;
}

type SoloDeps = Pick<AppDeps, 'pool' | 'redis' | 'clock' | 'config' | 'events' | 'log'>;

export async function soloQuestion(deps: SoloDeps, round: SoloRound, seq: number): Promise<QuestionRow> {
  const qid = round.questionIds[seq - 1];
  if (!qid) throw notFound(`This round has ${round.questionIds.length} questions.`);
  const question = await loadQuestion(deps.pool, qid);
  if (!question) throw notFound('This question is no longer available.');
  return question;
}

/** Shows question `seq`; serving it again returns the first served time, so the timer never resets. */
export async function serveSolo(
  deps: SoloDeps,
  store: RoundStore,
  round: SoloRound,
  seq: number,
  request: FastifyRequest,
): Promise<{ served: ServedQuestion; first: boolean }> {
  const question = await soloQuestion(deps, round, seq);
  const previous = (await store.answers(round.id, round.questionIds.length)).slice(0, seq - 1);
  if (previous.some((a) => a === null)) {
    throw conflict(ErrorCode.outOfOrder, 'Answer the previous question first');
  }
  const { servedAtMs, first } = await store.markServed(round.id, question.id, round.userId, deps.clock.now());
  if (first) {
    await deps.events.emit(
      'question_served',
      { qid: question.id, mode: round.mode, seq },
      requestEventContext(request),
    );
  }
  const perm = optionPermutation(question.options.length, shuffleSeed(round.id, round.userId, question.id));
  return {
    first,
    served: {
      qid: question.id,
      seq,
      total: round.questionIds.length,
      type: question.type,
      category_id: question.category_id,
      text: question.text,
      options: displayOrder(question.options, perm),
      media: null,
      time_limit_ms: round.timeLimitMs,
      served_at: new Date(servedAtMs).toISOString(),
    },
  };
}

/** Scores the answer to question `seq` once; a retry gets the stored answer back. */
export async function answerSolo(
  deps: SoloDeps,
  store: RoundStore,
  round: SoloRound,
  seq: number,
  body: AnswerRequest,
  request: FastifyRequest,
): Promise<{ response: AnswerResponse; answers: Array<StoredAnswer | null> }> {
  const question = await soloQuestion(deps, round, seq);
  const answers = await store.answers(round.id, round.questionIds.length);
  const previous = answers.slice(0, seq - 1);

  const already = answers[seq - 1];
  if (already) return { response: toResponse(already, previous, question), answers };
  if (previous.some((a) => a === null))
    throw conflict(ErrorCode.outOfOrder, 'Answer the previous question first');
  const servedAtMs = await store.servedAt(round.id, question.id, round.userId);
  if (servedAtMs === null)
    throw conflict(ErrorCode.questionNotServed, 'This question has not been shown yet');

  const now = deps.clock.now();
  const rtt = await rttFor(
    deps.redis,
    round.userId,
    requestEventContext(request).sessionId,
    deps.config.defaultRttMs,
  );
  const timing = acceptElapsed({
    clientElapsedMs: body.client_elapsed_ms,
    serverElapsedMs: Math.max(0, now - servedAtMs),
    rttEstMs: rtt,
    timeLimitMs: round.timeLimitMs,
  });
  const perm = optionPermutation(question.options.length, shuffleSeed(round.id, round.userId, question.id));
  if (body.display_index !== null && body.display_index >= perm.length) {
    throw new ApiError(400, ErrorCode.validation, 'The request is not valid', 'display_index: out of range');
  }
  const canonicalIndex =
    body.display_index === null || timing.timedOut ? null : toCanonicalIndex(perm, body.display_index);
  const correct = canonicalIndex === question.correct_index;
  const streakBefore = previous.at(-1)?.streakAfter ?? 0;
  const score = scoreAnswer({
    correct,
    elapsedMs: timing.acceptedMs,
    timeLimitMs: round.timeLimitMs,
    streakBefore,
  });

  const { answer, first } = await store.saveAnswer(round.id, {
    seq,
    qid: question.id,
    correct,
    timedOut: timing.timedOut,
    points: score.points,
    breakdown: { base: score.base, speed: score.speed, streak: score.streak },
    streakAfter: score.streakAfter,
    acceptedMs: timing.acceptedMs,
    serverElapsedMs: now - servedAtMs,
    clientElapsedMs: body.client_elapsed_ms,
    rttEstMs: rtt,
    displayIndex: body.display_index,
    canonicalIndex,
    correctDisplayIndex: toDisplayIndex(perm, question.correct_index),
    tabHiddenMs: body.tab_hidden_ms ?? null,
    answeredAt: now,
  });

  if (first) {
    await recordQuestionStats(deps.redis, deps.log, question.id, answer);
    await deps.events.emit(
      'question_answered',
      {
        qid: question.id,
        category: question.category_id,
        difficulty: question.difficulty,
        correct: answer.correct,
        timed_out: answer.timedOut,
        accepted_elapsed_ms: answer.acceptedMs,
        points: answer.points,
        mode: round.mode,
        lifeline: null,
        ...(answer.tabHiddenMs !== null ? { tab_hidden_ms: answer.tabHiddenMs } : {}),
      },
      requestEventContext(request),
    );
  }
  const saved = [...answers];
  saved[seq - 1] = answer;
  return { response: toResponse(answer, previous, question), answers: saved };
}

function toResponse(
  answer: StoredAnswer,
  previous: Array<StoredAnswer | null>,
  question: QuestionRow,
): AnswerResponse {
  return {
    correct: answer.correct,
    timed_out: answer.timedOut,
    correct_display_index: answer.correctDisplayIndex,
    points: answer.points,
    breakdown: answer.breakdown,
    fact: question.fact,
    running_score: previous.reduce((sum, a) => sum + (a?.points ?? 0), 0) + answer.points,
    streak: answer.streakAfter,
  };
}
