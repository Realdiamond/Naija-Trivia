/**
 * The console's Overview and Live (doc 18 §5–6, build plan step 2.7a). Reading needs
 * `overview.view`; removing someone from a party room or closing it needs `live.manage`, a
 * reason, and goes in the audit log.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  LiveFeedQuery,
  LiveOnlineQuery,
  LiveRoomClose,
  LiveRoomKick,
  type ConsoleOverview,
  type LiveFeed,
  type LiveOnline,
  type LiveRooms,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { notFound, parse } from '../errors';
import type { PartyRooms } from '../party/registry';
import { writeAudit } from './audit';
import { consoleOverview, liveFeed, liveOnline } from './console';
import { requireAdmin } from './context';
import { AdminSessions } from './sessions';

const RoomParams = z.object({ code: z.string().min(4).max(8) });

export function adminConsoleRoutes(app: FastifyInstance, deps: AppDeps, rooms: PartyRooms): void {
  const { pool, redis, clock } = deps;
  const ctx = { pool, sessions: new AdminSessions(redis, clock.now), now: clock.now };

  app.get('/admin/console/overview', async (request): Promise<ConsoleOverview> => {
    await requireAdmin(request, ctx, 'overview.view');
    return consoleOverview(deps, rooms, clock.now());
  });

  app.get('/admin/live/online', async (request): Promise<LiveOnline> => {
    await requireAdmin(request, ctx, 'overview.view');
    return liveOnline(deps, clock.now(), parse(LiveOnlineQuery, request.query).platform);
  });

  app.get('/admin/live/rooms', async (request): Promise<LiveRooms> => {
    await requireAdmin(request, ctx, 'overview.view');
    return { rooms: rooms.list().map((r) => r.staffView()) };
  });

  app.get('/admin/live/feed', async (request): Promise<LiveFeed> => {
    await requireAdmin(request, ctx, 'overview.view');
    return liveFeed(deps, clock.now(), parse(LiveFeedQuery, request.query).after);
  });

  app.post('/admin/live/rooms/:code/kick', async (request) => {
    const admin = await requireAdmin(request, ctx, 'live.manage');
    const room = rooms.byCode(parse(RoomParams, request.params).code);
    if (!room) throw notFound('This room has closed.');
    const body = parse(LiveRoomKick, request.body);
    const seat = room.staffView().players.find((p) => p.id === body.player_id);
    if (!seat || !room.removeByStaff(body.player_id)) {
      throw notFound('That player is not in the room (the host can only be removed by closing it).');
    }
    await writeAudit(pool, {
      actor: admin.id,
      action: 'party_kick',
      entity: 'party_room',
      entityId: room.code,
      reason: body.reason,
      after: { player: seat.name, kind: seat.kind },
      ip: request.ip,
    });
    return room.staffView();
  });

  app.post('/admin/live/rooms/:code/close', async (request) => {
    const admin = await requireAdmin(request, ctx, 'live.manage');
    const room = rooms.byCode(parse(RoomParams, request.params).code);
    if (!room) throw notFound('This room has closed.');
    const body = parse(LiveRoomClose, request.body);
    const before = room.staffView();
    room.close();
    await writeAudit(pool, {
      actor: admin.id,
      action: 'party_close',
      entity: 'party_room',
      entityId: room.code,
      reason: body.reason,
      before: { host: before.host, players: before.players.length, phase: before.phase },
      ip: request.ip,
    });
    return { closed: true };
  });
}
