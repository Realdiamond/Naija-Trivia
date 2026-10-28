/**
 * Daily and leaderboard endpoints (doc 09 §2.6). Guests play the Daily too: a friend arriving
 * from a shared grid on WhatsApp can play it in the browser at once.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DAILY_QUESTIONS } from '@whosabi/game-rules';
import {
  AnswerRequest,
  LeaderboardQuery,
  type DailyAnswerResponse,
  type DailyResult,
  type DailyToday,
  type LeaderboardResponse,
  type ServedQuestion,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { parse } from '../errors';
import { DailyService } from './service';

const DailyParams = z.object({ dailyId: z.coerce.number().int().positive().max(1_000_000) });
const QuestionParams = DailyParams.extend({ seq: z.coerce.number().int().min(1).max(DAILY_QUESTIONS) });

export function dailyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const daily = new DailyService(deps);

  app.get('/v1/daily/today', async (request): Promise<DailyToday> =>
    daily.todayFor(requireAuth(request).userId),
  );

  app.post('/v1/daily/:dailyId/questions/:seq/serve', async (request): Promise<ServedQuestion> => {
    const auth = requireAuth(request);
    const { dailyId, seq } = parse(QuestionParams, request.params);
    return daily.serve(dailyId, seq, auth.userId, request);
  });

  app.post('/v1/daily/:dailyId/questions/:seq/answer', async (request): Promise<DailyAnswerResponse> => {
    const auth = requireAuth(request);
    const { dailyId, seq } = parse(QuestionParams, request.params);
    return daily.answer(dailyId, seq, parse(AnswerRequest, request.body), auth.userId, request);
  });

  app.get('/v1/daily/:dailyId/result', async (request): Promise<DailyResult> => {
    const auth = requireAuth(request);
    const { dailyId } = parse(DailyParams, request.params);
    return daily.result(dailyId, auth.userId, request);
  });

  app.get('/v1/daily/:dailyId/leaderboard', async (request): Promise<LeaderboardResponse> => {
    const auth = requireAuth(request);
    const { dailyId } = parse(DailyParams, request.params);
    const { scope } = parse(LeaderboardQuery, request.query);
    return daily.dailyLeaderboard(dailyId, scope, auth.userId);
  });

  app.get('/v1/leaderboards/week', async (request): Promise<LeaderboardResponse> => {
    const auth = requireAuth(request);
    const { scope } = parse(LeaderboardQuery, request.query);
    return daily.weekLeaderboard(scope, auth.userId);
  });
}
