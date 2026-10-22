/**
 * Solo rounds (the first-run taste test for now). One question at a time, server-side
 * timing, per-player option order, scoring from packages/game-rules (TRD §5.1–5.4).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  acceptElapsed,
  DEFAULT_CONFIG,
  displayOrder,
  optionPermutation,
  scoreAnswer,
  shuffleSeed,
  toCanonicalIndex,
  toDisplayIndex,
  watDate,
} from '@whosabi/game-rules';
import {
  AnswerRequest,
  ErrorCode,
  StartRoundRequest,
  type AnswerResponse,
  type RoundResult,
  type ServedQuestion,
  type StartRoundResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { loadQuestion, pickTasteTestQuestions, type QuestionRow } from '../content/questions';
import { ApiError, conflict, notFound, parse } from '../errors';
import { requestEventContext } from '../events';
import { recordQuestionStats } from '../content/stats';
import { newId } from '../ids';
import { RoundStore, type RoundDef, type StoredAnswer } from './store';

const RoundParams = z.object({ roundId: z.string().min(3).max(40) });
const QuestionParams = RoundParams.extend({ seq: z.coerce.number().int().min(1).max(50) });

export function roundRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { pool, clock, config, events } = deps;
  const store = new RoundStore(deps.redis);

  async function ownedRound(roundId: string, userId: string): Promise<RoundDef> {
    const round = await store.get(roundId);
    // Someone else's round looks exactly like a missing one.
    if (!round || round.userId !== userId) throw notFound('This round has ended or does not exist.');
    return round;
  }

  async function questionFor(round: RoundDef, seq: number): Promise<QuestionRow> {
    const qid = round.questionIds[seq - 1];
    if (!qid) throw notFound(`This round has ${round.questionIds.length} questions.`);
    const question = await loadQuestion(pool, qid);
    if (!question) throw notFound('This question is no longer available.');
    return question;
  }

  app.post('/v1/rounds', async (request, reply) => {
    const auth = requireAuth(request);
    const { mode } = parse(StartRoundRequest, request.body);
    const now = clock.now();
    const questions = await pickTasteTestQuestions(pool, watDate(now));
    if (questions.length === 0) {
      throw new ApiError(
        503,
        ErrorCode.noQuestions,
        'No questions are available right now',
        'Try again soon.',
      );
    }
    const round: RoundDef = {
      id: newId('r', now),
      userId: auth.userId,
      mode,
      questionIds: questions.map((q) => q.id),
      categories: questions.map((q) => q.category_id),
      timeLimitMs: DEFAULT_CONFIG['duel.timer_text_s'] * 1000,
      createdAt: now,
    };
    await store.create(round);
    const body: StartRoundResponse = {
      round_id: round.id,
      mode,
      total: round.questionIds.length,
      categories: round.categories,
    };
    return reply.code(201).send(body);
  });

  app.post('/v1/rounds/:roundId/questions/:seq/serve', async (request): Promise<ServedQuestion> => {
    const auth = requireAuth(request);
    const { roundId, seq } = parse(QuestionParams, request.params);
    const round = await ownedRound(roundId, auth.userId);
    const question = await questionFor(round, seq);
    const previous = (await store.answers(round.id, round.questionIds.length)).slice(0, seq - 1);
    if (previous.some((a) => a === null)) {
      throw conflict(ErrorCode.outOfOrder, 'Answer the previous question first');
    }

    const { servedAtMs, first } = await store.markServed(round.id, question.id, auth.userId, clock.now());
    if (first) {
      await events.emit(
        'question_served',
        { qid: question.id, mode: round.mode, seq },
        requestEventContext(request),
      );
    }
    const perm = optionPermutation(question.options.length, shuffleSeed(round.id, auth.userId, question.id));
    return {
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
    };
  });

  app.post('/v1/rounds/:roundId/questions/:seq/answer', async (request): Promise<AnswerResponse> => {
    const auth = requireAuth(request);
    const { roundId, seq } = parse(QuestionParams, request.params);
    const body = parse(AnswerRequest, request.body);
    const round = await ownedRound(roundId, auth.userId);
    const question = await questionFor(round, seq);
    const answers = await store.answers(round.id, round.questionIds.length);
    const previous = answers.slice(0, seq - 1);

    const already = answers[seq - 1];
    if (already) return toResponse(already, previous, question);
    if (previous.some((a) => a === null))
      throw conflict(ErrorCode.outOfOrder, 'Answer the previous question first');
    const servedAtMs = await store.servedAt(round.id, question.id, auth.userId);
    if (servedAtMs === null)
      throw conflict(ErrorCode.questionNotServed, 'This question has not been shown yet');

    const now = clock.now();
    const timing = acceptElapsed({
      clientElapsedMs: body.client_elapsed_ms,
      serverElapsedMs: Math.max(0, now - servedAtMs),
      rttEstMs: config.defaultRttMs,
      timeLimitMs: round.timeLimitMs,
    });
    const perm = optionPermutation(question.options.length, shuffleSeed(round.id, auth.userId, question.id));
    if (body.display_index !== null && body.display_index >= perm.length) {
      throw new ApiError(
        400,
        ErrorCode.validation,
        'The request is not valid',
        'display_index: out of range',
      );
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
      rttEstMs: config.defaultRttMs,
      displayIndex: body.display_index,
      canonicalIndex,
      correctDisplayIndex: toDisplayIndex(perm, question.correct_index),
      tabHiddenMs: body.tab_hidden_ms ?? null,
      answeredAt: now,
    });

    if (first) {
      await recordQuestionStats(deps.redis, deps.log, question.id, answer);
      await events.emit(
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
    return toResponse(answer, previous, question);
  });

  app.get('/v1/rounds/:roundId', async (request): Promise<RoundResult> => {
    const auth = requireAuth(request);
    const { roundId } = parse(RoundParams, request.params);
    const round = await ownedRound(roundId, auth.userId);
    const answers = (await store.answers(round.id, round.questionIds.length)).filter(
      (a): a is StoredAnswer => a !== null,
    );
    return {
      round_id: round.id,
      mode: round.mode,
      total: round.questionIds.length,
      answered: answers.length,
      correct_count: answers.filter((a) => a.correct).length,
      score: answers.reduce((sum, a) => sum + a.points, 0),
      complete: answers.length === round.questionIds.length,
      answers: answers.map((a) => ({ seq: a.seq, qid: a.qid, correct: a.correct, points: a.points })),
    };
  });
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
