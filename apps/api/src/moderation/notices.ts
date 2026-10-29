/**
 * What the Who Sabi team told a player (build plan step 2.7d): a moderator's warning, or their
 * username taken away. The app shows each one until the player has seen it.
 */
import type { PlayerNotice } from '@whosabi/shared-types';
import type { Pool, PoolClient } from '../db';

const NOTICE_KINDS: Record<string, PlayerNotice['kind']> = { warn: 'warning', rename: 'renamed' };

export async function unseenNotices(db: Pool | PoolClient, userId: string): Promise<PlayerNotice[]> {
  const rows = await db.query<{ id: string; action: string; message: string | null; created_at: Date }>(
    `SELECT id, action, message, created_at FROM moderation_actions
      WHERE target_user_id = $1 AND action IN ('warn', 'rename') AND seen_at IS NULL
      ORDER BY id LIMIT 5`,
    [userId],
  );
  return rows.rows.map((r) => ({
    id: Number(r.id),
    kind: NOTICE_KINDS[r.action]!,
    message: r.message,
    at: r.created_at.toISOString(),
  }));
}

export async function markNoticeSeen(db: Pool | PoolClient, userId: string, id: number, now: number) {
  await db.query(
    'UPDATE moderation_actions SET seen_at = $3 WHERE id = $1 AND target_user_id = $2 AND seen_at IS NULL',
    [id, userId, new Date(now)],
  );
}
