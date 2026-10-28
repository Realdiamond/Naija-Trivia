/** Categories, and player reports on a question (doc 09 §2.4, PRD US-9). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { QuestionReportRequest, type CategoriesResponse } from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { parse } from '../errors';
import { requestEventContext } from '../events';
import { listCategories } from './questions';
import { reportQuestion } from './reports';

const QuestionParams = z.object({ id: z.string().min(3).max(60) });

export function contentRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/categories', async (): Promise<CategoriesResponse> => ({
    categories: await listCategories(deps.pool),
  }));

  // One report per player and question; the limit stops one account from flooding the queue.
  app.post(
    '/v1/questions/:id/reports',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 hour',
          keyGenerator: (request) => request.auth?.userId ?? request.ip,
        },
      },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parse(QuestionParams, request.params);
      const body = parse(QuestionReportRequest, request.body);
      const outcome = await reportQuestion(deps.pool, {
        questionId: id,
        userId: auth.userId,
        reason: body.reason,
        note: body.note || null,
        now: deps.clock.now(),
      });
      if (outcome.recorded) {
        await deps.events.emit(
          'question_reported',
          { qid: id, reason: body.reason },
          requestEventContext(request),
        );
      }
      if (outcome.suspended) deps.log.warn({ question_id: id }, 'question suspended by player reports');
      return reply.code(202).send({ received: true });
    },
  );
}
