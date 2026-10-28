/**
 * Phones and browsers that get pushes (doc 09 §2.2). Guests too: a friend who came from a
 * WhatsApp link should still hear that it's their turn.
 */
import type { FastifyInstance } from 'fastify';
import {
  ErrorCode,
  ForgetDeviceRequest,
  RegisterDeviceRequest,
  type WebPushKeyResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { withTransaction } from '../db';
import { ApiError, parse } from '../errors';
import { newId } from '../ids';
import { isPushService } from './webpush';

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
  // Browsers subscribe with this key (step 2.5c); without one, the web app asks for no pushes.
  app.get('/v1/push/web-key', async (): Promise<WebPushKeyResponse> => ({
    public_key: deps.config.webPush?.publicKey ?? null,
  }));

  app.post('/v1/me/devices', limit, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = parse(RegisterDeviceRequest, request.body);
    if (body.platform === 'web' && !isPushService(body.subscription.endpoint)) {
      // We only ever send to browsers' push services, never wherever a request points.
      throw new ApiError(400, ErrorCode.validation, 'The request is not valid', 'Unknown push service.');
    }
    const device =
      body.platform === 'web'
        ? {
            token: body.subscription.endpoint,
            keys: {
              p256dh: body.subscription.keys.p256dh.replace(/=+$/, ''),
              auth: body.subscription.keys.auth.replace(/=+$/, ''),
            },
            model: null,
            browser: body.browser ?? null,
          }
        : { token: body.push_token, keys: null, model: body.model ?? null, browser: null };
    const now = new Date(deps.clock.now());
    await withTransaction(deps.pool, async (client) => {
      // The token now belongs to whoever is signed in on this phone.
      await client.query(
        `INSERT INTO devices (id, user_id, platform, push_token, web_keys, app_version, model, browser,
                              last_seen_at, token_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         ON CONFLICT (push_token) WHERE push_token IS NOT NULL
         DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, web_keys = EXCLUDED.web_keys,
                       app_version = EXCLUDED.app_version, model = EXCLUDED.model, browser = EXCLUDED.browser,
                       last_seen_at = EXCLUDED.last_seen_at, token_updated_at = EXCLUDED.token_updated_at`,
        [
          newId('dev'),
          userId,
          body.platform,
          device.token,
          device.keys,
          body.app_version ?? null,
          device.model,
          device.browser,
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
