/** Whether a player account belongs to staff who may use the Staff tab (Me.staff, step 2.9a). */
import type { Pool } from '../db';
import { loadAdmin } from './context';
import { canUsePhone } from './phones';

export async function isStaffPlayer(pool: Pool, playerId: string, now: number): Promise<boolean> {
  const linked = await pool.query<{ id: string }>('SELECT id FROM admin_users WHERE player_id = $1', [
    playerId,
  ]);
  const id = linked.rows[0]?.id;
  if (!id) return false;
  const admin = await loadAdmin(pool, id, now);
  return admin !== null && canUsePhone(admin);
}
