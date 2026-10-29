/**
 * Share pictures and app links (doc 09 §5).
 *
 * - /og/…: the link-preview pictures WhatsApp and X fetch, public and cached.
 * - /v1/share/…: Status pictures of a finished duel or Daily, for the players in it only.
 * - /.well-known/…: the files that let Android and iOS open whosabi.ng links in the app.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { notFound, parse } from '../errors';
import { ShareService } from './service';

/** The app's id on both stores (apps/app/app.json). */
export const APP_ID = 'ng.whosabi.app';

const DuelParams = z.object({ duelId: z.string().min(3).max(40) });
const DailyParams = z.object({ dailyId: z.coerce.number().int().positive().max(1_000_000) });
const InviteFile = /^([A-Za-z0-9_-]{16,64})\.png$/;
const DailyFile = /^(\d{1,7})\.png$/;

// Drawing a picture takes a moment of CPU; caches in front keep the repeat fetches cheap.
const perIp = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });
const perPlayer = {
  config: {
    rateLimit: {
      max: 20,
      timeWindow: '1 minute',
      keyGenerator: (request: { auth?: { userId: string } | null; ip: string }) =>
        request.auth?.userId ?? request.ip,
    },
  },
};

function png(reply: FastifyReply, body: Buffer, cache: string): FastifyReply {
  return reply.type('image/png').header('cache-control', cache).send(body);
}

export function shareRoutes(app: FastifyInstance, deps: AppDeps): void {
  const share = new ShareService(deps);

  app.get('/og/default.png', perIp(60), async (_request, reply) =>
    png(reply, await share.defaultPreview(), 'public, max-age=86400'),
  );

  app.get('/og/invite/:file', perIp(60), async (request, reply) => {
    const token = InviteFile.exec((request.params as { file: string }).file)?.[1];
    if (!token) throw notFound();
    // Short: the picture changes once someone takes the challenge.
    return png(reply, await share.invitePreview(token), 'public, max-age=300');
  });

  app.get('/og/daily/:file', perIp(60), async (request, reply) => {
    const n = DailyFile.exec((request.params as { file: string }).file)?.[1];
    if (!n) throw notFound();
    return png(reply, await share.dailyPreview(Number(n)), 'public, max-age=86400');
  });

  app.get('/v1/share/duels/:duelId/card.png', perPlayer, async (request, reply) => {
    const auth = requireAuth(request);
    const { duelId } = parse(DuelParams, request.params);
    return png(reply, await share.duelCard(duelId, auth.userId), 'private, max-age=3600');
  });

  app.get('/v1/share/daily/:dailyId/card.png', perPlayer, async (request, reply) => {
    const auth = requireAuth(request);
    const { dailyId } = parse(DailyParams, request.params);
    // The percentage beaten moves as others finish, so it is drawn afresh after a while.
    return png(reply, await share.dailyCard(dailyId, auth.userId, request), 'private, max-age=300');
  });

  // Android App Links: whosabi.ng links open the app once it is installed, with no chooser.
  app.get('/.well-known/assetlinks.json', async (_request, reply) => {
    void reply.header('cache-control', 'public, max-age=3600');
    const fingerprints = deps.config.androidCertSha256;
    return fingerprints.length === 0
      ? []
      : [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: APP_ID,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ];
  });

  // iOS Universal Links, once the Apple developer account exists.
  app.get('/.well-known/apple-app-site-association', async (_request, reply) => {
    const team = deps.config.appleTeamId;
    if (!team) throw notFound();
    void reply.type('application/json').header('cache-control', 'public, max-age=3600');
    return {
      applinks: {
        details: [
          {
            appIDs: [`${team}.${APP_ID}`],
            components: [{ '/': '/d/*' }, { '/': '/daily/*' }, { '/': '/duel/*' }, { '/': '/u/*' }],
          },
        ],
      },
    };
  });
}
