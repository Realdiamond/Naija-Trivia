/**
 * Questions past their "valid until" date leave the game (doc 04 §4, FR-CON-5). Picking already
 * skips them; this marks them retired so the console shows why, with a line in their history.
 */
import { watDate } from '@whosabi/game-rules';
import { withTransaction } from '../db';
import { addHistory } from '../content/bank';
import type { JobDeps } from './deps';

export async function retireExpiredQuestions(deps: Pick<JobDeps, 'pool' | 'clock'>): Promise<number> {
  const now = deps.clock.now();
  return withTransaction(deps.pool, async (client) => {
    const expired = await client.query<{ id: string; version: number; valid_until: string }>(
      `UPDATE questions SET status = 'retired', updated_at = $2
        WHERE status IN ('approved', 'live', 'suspended') AND valid_until < $1::date
        RETURNING id, version, to_char(valid_until, 'YYYY-MM-DD') AS valid_until`,
      [watDate(now), new Date(now)],
    );
    for (const q of expired.rows) {
      await addHistory(client, {
        questionId: q.id,
        action: 'expired',
        actor: 'system',
        note: `Valid until ${q.valid_until}`,
        version: q.version,
        at: now,
      });
    }
    return expired.rowCount ?? 0;
  });
}
