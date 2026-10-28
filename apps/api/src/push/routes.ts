/**
 * Phones that get pushes (doc 09 §2.2). Guests too: a friend who came from a WhatsApp link and
 * installed the app should still hear that it's their turn.
 */
import type { FastifyInstance } from 'fastify';
import { ForgetDeviceRequest, RegisterDeviceRequest } from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { withTransaction } from '../db';
import { parse } from '../errors';
import { newId } from '../ids';

/** A player's most recent phones; older tokens are dropped. */
const MAX_DEVICES = 10;

const limit = {
  config: {
    rateLimit: {
      max: 30,
      timeWindow: '1 hour',
      keyGenerator: (request: { auth?: { userId: string } | null; ip: string }) =>
        request.auth?.userId ?? request.ip,
    },
  },
};

export function pushRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/v1/me/devices', limit, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = parse(RegisterDeviceRequest, request.body);
    const now = new Date(deps.clock.now());
    await withTransaction(deps.pool, async (client) => {
      // The token now belongs to whoever is signed in on this phone.
      await client.query(
        `INSERT INTO devices (id, user_id, platform, push_token, app_version, model, last_seen_at, token_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (push_token) WHERE push_token IS NOT NULL
         DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
                       app_version = EXCLUDED.app_version, model = EXCLUDED.model,
                       last_seen_at = EXCLUDED.last_seen_at, token_updated_at = EXCLUDED.token_updated_at`,
        [
          newId('dev'),
          userId,
          body.platform,
          body.push_token,
          body.app_version ?? null,
          body.model ?? null,
          now,
        ],
      );
      await client.query(
        `UPDATE devices SET push_token = NULL
          WHERE user_id = $1 AND push_token IS NOT NULL AND id NOT IN (
            SELECT id FROM devices WHERE user_id = $1 AND push_token IS NOT NULL
             ORDER BY token_updated_at DESC NULLS LAST LIMIT $2)`,
        [userId, MAX_DEVICES],
      );
    });
    return reply.code(204).send();
  });

  app.delete('/v1/me/devices', limit, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { push_token: token } = parse(ForgetDeviceRequest, request.body);
    await deps.pool.query('UPDATE devices SET push_token = NULL WHERE user_id = $1 AND push_token = $2', [
      userId,
      token,
    ]);
    return reply.code(204).send();
  });
}
