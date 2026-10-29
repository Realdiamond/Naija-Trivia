/**
 * Party rooms over HTTP and WebSocket (API §2.7 and §3, build plan step 2.2a). A host makes a
 * room; anyone with the code takes a seat (signed in, or on the web with just a nickname,
 * FR-PARTY-7); each seat's WebSocket then talks to the room. A seat's token is only good for
 * its room's socket, never for the API.
 */
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  CreatePartyRequest,
  ErrorCode,
  JoinPartyRequest,
  PartyClientMessage,
  PartyCloseCode,
  routes,
  type CreatePartyResponse,
  type PartyGameResult,
  type PartyRoomPreview,
  type PartySeat,
  type Platform,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { PARTY_SEAT_TTL_SECONDS, type PartySeatClaims } from '../auth/tokens';
import { ApiError, conflict, notFound, parse } from '../errors';
import { requestEventContext } from '../events';
import { audienceOf } from '../liveops/store';
import { checkUsername } from '../profile/usernames';
import type { PartyRooms } from './registry';
import { getGame } from './results';
import type { Connection, PartyRoom } from './room';

const CodeParams = z.object({ code: z.string().min(1).max(12) });
const GameParams = z.object({ gameId: z.string().regex(/^pg_[0-9A-Z]{26}$/) });
const SocketQuery = z.object({ token: z.string().min(20).max(2000) });

/** A connection may send this many messages a second, with a burst of twice that. */
const MESSAGES_PER_SECOND = 10;
/** Pings keep the connection open through Heroku's 55 s idle limit and measure the round trip. */
const PING_EVERY_MS = 15_000;

const roomGone = () =>
  new ApiError(
    404,
    ErrorCode.partyRoomNotFound,
    'This party is not on',
    'Check the code, or ask for a new link.',
  );

export function partyRoutes(app: FastifyInstance, deps: AppDeps, rooms: PartyRooms): void {
  const { pool, tokens, clock } = deps;

  /** Who a signed-in player is in a room: their username, or the nickname a guest typed. */
  async function seatFor(
    request: FastifyRequest,
    nickname: string | undefined,
  ): Promise<Omit<PartySeatClaims, 'roomId'>> {
    const auth = request.auth;
    if (!auth) {
      return {
        seat: `g:${randomBytes(9).toString('base64url')}`,
        name: allowedNickname(nickname),
        kind: 'web_guest',
        role: 'player',
        userId: null,
        avatarId: null,
        platform: 'web',
      };
    }
    const user = (
      await pool.query<{ username: string | null; avatar_id: string | null }>(
        "SELECT username, avatar_id FROM users WHERE id = $1 AND status IN ('guest', 'active', 'restricted')",
        [auth.userId],
      )
    ).rows[0];
    if (!user) throw new ApiError(403, ErrorCode.accountUnavailable, 'This account is not available');
    return {
      seat: `u:${auth.userId}`,
      name: user.username ?? allowedNickname(nickname),
      kind: kindFor(auth.platform),
      role: 'player',
      userId: auth.userId,
      avatarId: user.avatar_id,
      platform: auth.platform,
    };
  }

  async function seatResponse(room: PartyRoom, claims: Omit<PartySeatClaims, 'roomId'>): Promise<PartySeat> {
    return {
      room_id: room.id,
      code: room.code,
      token: await tokens.signPartySeat({ ...claims, roomId: room.id }),
      socket_path: routes.partySocket(),
      expires_at: new Date(clock.now() + PARTY_SEAT_TTL_SECONDS * 1000).toISOString(),
    };
  }

  // The kill switch (step 2.7c) stops new rooms and new seats; games already going carry on.
  const partyOn = (request: FastifyRequest) =>
    deps.liveops.require(
      'party.enabled',
      audienceOf(request),
      'Party rooms are taking a short break. Duels and the Daily still work.',
    );

  app.post(
    '/v1/party/rooms',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (request, reply) => {
      requireAuth(request);
      await partyOn(request);
      const body = parse(CreatePartyRequest, request.body);
      const known = await pool.query<{ id: string }>(
        'SELECT id FROM categories WHERE active AND id = ANY($1)',
        [body.settings.categories],
      );
      if (known.rows.length !== new Set(body.settings.categories).size) {
        throw new ApiError(
          400,
          ErrorCode.validation,
          'The request is not valid',
          'categories: not all are open',
        );
      }
      const host = await seatFor(request, body.nickname);
      const room = await rooms.create(host, body.settings);
      const ctx = requestEventContext(request);
      await deps.events.emit(
        'party_room_created',
        {
          questions: body.settings.questions,
          timer_s: body.settings.timer_s,
          packs: body.settings.categories,
          family_safe: body.settings.family_safe,
          client: host.kind === 'app' ? 'app' : 'web_app',
        },
        ctx,
      );
      const response: CreatePartyResponse = { room: room.preview(), seat: await seatResponse(room, host) };
      return reply.code(201).send(response);
    },
  );

  // Public: the card behind a /r/{CODE} link.
  app.get(
    '/v1/party/rooms/:code',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request): Promise<PartyRoomPreview> => {
      const room = rooms.byCode(parse(CodeParams, request.params).code);
      if (!room) throw roomGone();
      return room.preview();
    },
  );

  // The room's link as a QR code, for the lobby: friends in the same room scan it.
  app.get(
    '/v1/party/rooms/:code/qr.svg',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const room = rooms.byCode(parse(CodeParams, request.params).code);
      if (!room) throw roomGone();
      const svg = await QRCode.toString(room.preview().link, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#14231B', light: '#FFFFFF' },
      });
      return reply.type('image/svg+xml').header('cache-control', 'public, max-age=3600').send(svg);
    },
  );

  // A whole party may share one Wi-Fi, so the limit per address is generous.
  app.post(
    '/v1/party/rooms/:code/join',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request): Promise<PartySeat> => {
      const room = rooms.byCode(parse(CodeParams, request.params).code);
      if (!room) throw roomGone();
      await partyOn(request);
      const body = parse(JoinPartyRequest, request.body ?? {});
      let claims: Omit<PartySeatClaims, 'roomId'>;
      if (body.screen) {
        const auth = requireAuth(request);
        if (!room.isHostUser(auth.userId)) {
          throw new ApiError(403, ErrorCode.forbidden, 'Only the host can open the big screen');
        }
        claims = {
          seat: `s:${randomBytes(9).toString('base64url')}`,
          name: 'Screen',
          kind: kindFor(auth.platform),
          role: 'screen',
          userId: null,
          avatarId: null,
          platform: auth.platform,
        };
      } else {
        claims = await seatFor(request, body.nickname);
      }
      const refusal = room.refusal(claims);
      if (refusal === 'kicked')
        throw new ApiError(403, ErrorCode.forbidden, 'The host removed you from this room');
      if (refusal === 'full') throw conflict(ErrorCode.partyRoomFull, 'This room is full or locked');
      if (refusal === 'closed') throw roomGone();
      return seatResponse(room, claims);
    },
  );

  app.get('/v1/party/games/:gameId', async (request): Promise<PartyGameResult> => {
    const game = await getGame(pool, parse(GameParams, request.params).gameId);
    if (!game) throw notFound('This game does not exist.');
    return game;
  });

  // The room's WebSocket. The token is in the address, so these requests are not logged.
  app.get(routes.partySocket(), { websocket: true, logLevel: 'warn' }, (socket, request) => {
    let joined: { room: PartyRoom; seat: string } | null = null;
    const waiting: string[] = [];
    let allowance = MESSAGES_PER_SECOND * 2;
    let refilledAt = performance.now();

    const deliver = (raw: string) => {
      const now = performance.now();
      allowance = Math.min(
        MESSAGES_PER_SECOND * 2,
        allowance + ((now - refilledAt) / 1000) * MESSAGES_PER_SECOND,
      );
      refilledAt = now;
      if (allowance < 1 || !joined) return;
      allowance--;
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        message = null;
      }
      const parsed = PartyClientMessage.safeParse(message);
      if (!parsed.success) {
        socket.send(
          JSON.stringify({ type: 'error', code: 'BAD_MESSAGE', message: 'Not a message this room knows.' }),
        );
        return;
      }
      joined.room.handle(joined.seat, parsed.data);
    };

    // Messages can arrive while the token is being checked: they wait their turn.
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const raw = String(data);
      if (joined) deliver(raw);
      else if (waiting.length < 10) waiting.push(raw);
    });

    void (async () => {
      const query = SocketQuery.safeParse(request.query);
      let claims: PartySeatClaims;
      try {
        if (!query.success) throw new Error('no token');
        claims = await tokens.verifyPartySeat(query.data.token);
      } catch {
        socket.close(PartyCloseCode.authFailed, 'Join the room again');
        return;
      }
      const room = rooms.byId(claims.roomId);
      if (!room) {
        socket.close(PartyCloseCode.closed, 'This room has closed');
        return;
      }
      if (socket.readyState !== socket.OPEN) return;
      const conn: Connection = {
        send: (message) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
        },
        close: (code, reason) => socket.close(code, reason),
      };
      let pingedAt = 0;
      const ping = () => {
        pingedAt = performance.now();
        socket.ping();
      };
      const pinger = setInterval(ping, PING_EVERY_MS);
      socket.on('pong', () => room.rttSample(claims.seat, Math.round(performance.now() - pingedAt)));
      socket.on('close', () => {
        clearInterval(pinger);
        room.disconnect(claims.seat, conn);
      });
      joined = { room, seat: claims.seat };
      room.join(claims, conn);
      ping();
      for (const raw of waiting.splice(0)) deliver(raw);
    })();
  });
}

function kindFor(platform: Platform) {
  return platform === 'web' ? ('web' as const) : ('app' as const);
}

function allowedNickname(nickname: string | undefined): string {
  if (!nickname) {
    throw new ApiError(400, ErrorCode.nicknameRequired, 'Pick a nickname', 'Everyone in the room sees it.');
  }
  if (!checkUsername(nickname.replace(/\s+/g, '_')).ok) {
    throw new ApiError(
      400,
      ErrorCode.nicknameNotAllowed,
      'Pick another nickname',
      'That one is not allowed.',
    );
  }
  return nickname;
}
