import type { DuelService } from '../duels/service';

/** Ends every duel past its turn deadline, a batch at a time (TRD §5.2: forfeit or cancelled). */
export async function expireDueDuels(duels: DuelService, batch = 100): Promise<number> {
  let total = 0;
  for (;;) {
    const expired = await duels.expireDue(batch);
    total += expired;
    if (expired < batch) return total;
  }
}
