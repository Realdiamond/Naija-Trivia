/** How the Packs pages describe a pack (step 2.8f). */
import type { AdminPack } from '@whosabi/shared-types';

/** Players need this many questions in a pack before it shows (PRACTICE_MIN_QUESTIONS). */
export const MIN_QUESTIONS = 10;

export function accessLine(pack: AdminPack): string {
  if (pack.access === 'coins') return `${pack.price_coins} coins`;
  if (pack.access === 'pass') return 'Sabi Pass';
  return pack.access === 'sponsored' ? 'Sponsored' : 'Free';
}

export function packState(pack: AdminPack, now: number): { label: string; tone: '' | 'warn' | 'off' } {
  if (!pack.active) return { label: 'Switched off', tone: 'off' };
  if (pack.starts_at && Date.parse(pack.starts_at) > now) return { label: 'Not started', tone: 'warn' };
  if (pack.ends_at && Date.parse(pack.ends_at) <= now) return { label: 'Ended', tone: 'off' };
  if (pack.live < MIN_QUESTIONS) return { label: `Needs ${MIN_QUESTIONS} live questions`, tone: 'warn' };
  return { label: 'Showing', tone: '' };
}
