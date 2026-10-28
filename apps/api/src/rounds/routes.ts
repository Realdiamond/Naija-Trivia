/**
 * Solo rounds: the first-run taste test (doc 09 §2.4). Serving and answering are shared with the
 * Daily (rounds/solo.ts): one question at a time, server-side timing, per-player option order.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_CONFIG, watDate } from '@whosabi/game-rules';
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
import { pickTasteTestQuestions } from '../content/questions';
import { ApiError, notFound, parse } from '../errors';
import { newId } from '../ids';
import { answerSolo, serveSolo } from './solo';
import { RoundStore, type RoundDef, type StoredAnswer } from './store';

const RoundParams = z.object({ roundId: z.string().min(3).max(40) });
const QuestionParams = RoundParams.extend({ seq: z.coerce.number().int().min(1).max(50) });

export function roundRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { pool, clock } = deps;
  const store = new RoundStore(deps.redis);

  async function ownedRound(roundId: string, userId: string): Promise<RoundDef> {
    const round = await store.get(roundId);
    // Someone else's round looks exactly like a missing one.
    if (!round || round.userId !== userId) throw notFound('This round has ended or does not exist.');
    return round;
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
    return (await serveSolo(deps, store, round, seq, request)).served;
  });

  app.post('/v1/rounds/:roundId/questions/:seq/answer', async (request): Promise<AnswerResponse> => {
    const auth = requireAuth(request);
    const { roundId, seq } = parse(QuestionParams, request.params);
    const body = parse(AnswerRequest, request.body);
    const round = await ownedRound(roundId, auth.userId);
    return (await answerSolo(deps, store, round, seq, body, request)).response;
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
