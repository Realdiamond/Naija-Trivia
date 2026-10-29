/**
 * The player's own data rights (build plan step 2.8a): delete my account, at once and for good,
 * and download a copy of my data. Both are in the app's Settings and at /delete-account on the
 * web (Google Play's account deletion rule).
 */
import type { FastifyInstance } from 'fastify';
import { DeleteAccountRequest, type DeleteAccountResponse } from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../auth/routes';
import { parse } from '../errors';
import { newId } from '../ids';
import { DSAR_DAYS, eraseAccount, exportAccount } from './erase';

const DAY = 86_400_000;

export function complianceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { pool, clock, config } = deps;

  app.post(
    '/v1/me/delete',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply): Promise<DeleteAccountResponse> => {
      const { userId } = requireAuth(request);
      parse(DeleteAccountRequest, request.body);
      const erased = await eraseAccount(pool, config.analyticsKey, userId, clock.now(), {
        handledBy: 'player',
        source: 'app',
      });
      void reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      return { dsar_id: erased.dsarId };
    },
  );

  app.get(
    '/v1/me/export',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      const now = clock.now();
      const data = await exportAccount(pool, userId, now);
      await pool.query(
        `INSERT INTO dsar_requests (id, user_id, kind, status, due_at, completed_at, created_at, source, handled_by)
         VALUES ($1, $2, 'access', 'completed', $3, $4, $4, 'app', 'player')`,
        [newId('ds', now), userId, new Date(now + DSAR_DAYS * DAY), new Date(now)],
      );
      const day = new Date(now).toISOString().slice(0, 10);
      return reply
        .header('content-disposition', `attachment; filename="whosabi-data-${day}.json"`)
        .header('cache-control', 'no-store')
        .type('application/json')
        .send(JSON.stringify(data, null, 2));
    },
  );
}
