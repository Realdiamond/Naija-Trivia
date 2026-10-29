'use server';
/** The Live page's calls (doc 18 §6): what is happening now, and the moderators' room actions. */
import { routes, type LiveFeed, type LiveOnline, type LiveRooms } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';

export interface LiveData {
  online: LiveOnline;
  rooms: LiveRooms['rooms'];
  feed: LiveFeed['items'];
}

export async function loadLive(platform: string): Promise<LiveData> {
  const [online, rooms, feed] = await Promise.all([
    adminApi<LiveOnline>(routes.admin.liveOnline(platform || undefined)),
    adminApi<LiveRooms>(routes.admin.liveRooms()),
    adminApi<LiveFeed>(routes.admin.liveFeed()),
  ]);
  return { online, rooms: rooms.rooms, feed: feed.items };
}

const failed = (e: unknown) => (e instanceof AdminApiError ? e.message : 'That did not work. Try again.');

export async function removePlayer(code: string, playerId: string, reason: string): Promise<string | null> {
  try {
    await adminApi(routes.admin.liveKick(code), { method: 'POST', body: { player_id: playerId, reason } });
    return null;
  } catch (e) {
    return failed(e);
  }
}

export async function closeRoom(code: string, reason: string): Promise<string | null> {
  try {
    await adminApi(routes.admin.liveClose(code), { method: 'POST', body: { reason } });
    return null;
  } catch (e) {
    return failed(e);
  }
}
