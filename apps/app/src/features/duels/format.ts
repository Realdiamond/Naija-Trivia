import type { DuelPlayer } from '@whosabi/shared-types';

/** Whole hours left (rounded down), or minutes when under an hour; null once it has passed. */
export function timeLeft(
  deadline: string | null,
  now: number,
): { hours: number } | { minutes: number } | null {
  if (!deadline) return null;
  const ms = Date.parse(deadline) - now;
  if (!(ms > 0)) return null;
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? { hours } : { minutes: Math.max(1, Math.ceil(ms / 60_000)) };
}

/** Under 6 hours: shown in orange, like "6 hours left" on the home mockup. */
export function isUrgent(deadline: string | null, now: number): boolean {
  if (!deadline) return false;
  const ms = Date.parse(deadline) - now;
  return ms > 0 && ms < 6 * 3_600_000;
}

/** The opponent's name; guests have no username yet. */
export function playerName(player: DuelPlayer | null, guest: string, nobody: string): string {
  if (!player) return nobody;
  return player.username ?? guest;
}

/** The round a duel is on, for "Round 2 · their turn". */
export function currentRound(state: string): number {
  switch (state) {
    case 'created':
      return 1;
    case 'wait_b_r1r2':
      return 1;
    case 'wait_a_r2r3':
      return 2;
    case 'wait_b_r3':
      return 3;
    default:
      return 3;
  }
}

/** A stable Idempotency-Key for one answer, so a retry is never counted twice (doc 09 §1). */
export function answerKey(duelId: string, round: number, seq: number): string {
  return `ans-${round}-${seq}-${duelId.replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 64);
}
