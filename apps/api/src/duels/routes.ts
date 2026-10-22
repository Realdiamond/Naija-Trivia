/**
 * Duel endpoints (doc 09 §2.5). Everything needs a signed-in player (guests included, so a
 * friend from a WhatsApp link can play in the browser) except the public invite preview.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { QUESTIONS_PER_ROUND, TIEBREAK_ROUND } from '@whosabi/game-rules';
import {
  AnswerRequest,
  CreateDuelRequest,
  ListDuelsQuery,
  PickCategoryRequest,
  TiebreakAnswerRequest,
  type CreateDuelResponse,
  type DuelAnswerResponse,
  type DuelView,
  type InvitePreview,
  type ListDuelsResponse,
  type ServedQuestion,
  type TiebreakAnswerResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { parse } from '../errors';
import { requestEventContext } from '../events';
import { idempotencyKey, once } from '../idempotency';
import { DuelService } from './service';

const DuelParams = z.object({ duelId: z.string().min(3).max(40) });
const CategoryParams = DuelParams.extend({ round: z.coerce.number().int().min(1).max(3) });
const QuestionParams = DuelParams.extend({
  round: z.coerce.number().int().min(1).max(TIEBREAK_ROUND),
  seq: z.coerce.number().int().min(1).max(QUESTIONS_PER_ROUND),
});
const TokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });

export function duelRoutes(app: FastifyInstance, deps: AppDeps): void {
  const duels = new DuelService(deps);

  app.post('/v1/duels', async (request, reply) => {
    const auth = requireAuth(request);
    const body = parse(CreateDuelRequest, request.body);
    const ctx = requestEventContext(request);
    // A double tap on "Challenge" must not start two duels.
    const result = await once<CreateDuelResponse>(
      deps.redis,
      { userId: auth.userId, operation: 'duels.create' },
      idempotencyKey(request),
      async () => {
        const duel = await duels.create(auth.userId, body, ctx);
        return { status: 201, body: { duel, invite_url: duel.invite_url } };
      },
    );
    return reply.code(result.status).send(result.body);
  });

  app.get('/v1/duels', async (request): Promise<ListDuelsResponse> => {
    const auth = requireAuth(request);
    return duels.list(auth.userId, parse(ListDuelsQuery, request.query));
  });

  app.get('/v1/duels/:duelId', async (request): Promise<DuelView> => {
    const auth = requireAuth(request);
    return duels.get(parse(DuelParams, request.params).duelId, auth.userId);
  });

  app.post('/v1/duels/:duelId/rounds/:round/category', async (request): Promise<DuelView> => {
    const auth = requireAuth(request);
    const { duelId, round } = parse(CategoryParams, request.params);
    const { category_id: categoryId } = parse(PickCategoryRequest, request.body);
    return duels.pickCategory(duelId, round, categoryId, auth.userId);
  });

  app.post(
    '/v1/duels/:duelId/rounds/:round/questions/:seq/serve',
    async (request): Promise<ServedQuestion> => {
      const auth = requireAuth(request);
      const { duelId, round, seq } = parse(QuestionParams, request.params);
      return duels.serve(duelId, round, seq, auth.userId, requestEventContext(request));
    },
  );

  app.post(
    '/v1/duels/:duelId/rounds/:round/questions/:seq/answer',
    async (request): Promise<DuelAnswerResponse | TiebreakAnswerResponse> => {
      const auth = requireAuth(request);
      const { duelId, round, seq } = parse(QuestionParams, request.params);
      const key = idempotencyKey(request);
      const ctx = requestEventContext(request);
      // Round 4 is the tie-break: a number instead of an option.
      if (round === TIEBREAK_ROUND) {
        return duels.tiebreakAnswer(
          duelId,
          parse(TiebreakAnswerRequest, request.body),
          key,
          auth.userId,
          ctx,
        );
      }
      return duels.answer(duelId, round, seq, parse(AnswerRequest, request.body), key, auth.userId, ctx);
    },
  );

  app.post('/v1/duels/:duelId/decline', async (request): Promise<DuelView> => {
    const auth = requireAuth(request);
    return duels.decline(parse(DuelParams, request.params).duelId, auth.userId);
  });

  app.post('/v1/duels/:duelId/cancel', async (request): Promise<DuelView> => {
    const auth = requireAuth(request);
    return duels.cancel(parse(DuelParams, request.params).duelId, auth.userId);
  });

  app.post('/v1/duels/:duelId/rematch', async (request, reply) => {
    const auth = requireAuth(request);
    const { duel, created } = await duels.rematch(
      parse(DuelParams, request.params).duelId,
      auth.userId,
      requestEventContext(request),
    );
    return reply.code(created ? 201 : 200).send(duel);
  });

  // Public: the WhatsApp link preview and the web landing card ("Tolu don challenge you 🔥").
  app.get(
    '/v1/invites/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request): Promise<InvitePreview> => duels.invitePreview(parse(TokenParams, request.params).token),
  );

  app.post('/v1/invites/:token/accept', async (request): Promise<DuelView> => {
    const auth = requireAuth(request);
    return duels.acceptInvite(parse(TokenParams, request.params).token, auth.userId);
  });
}
