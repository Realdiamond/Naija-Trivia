/**
 * Lifelines in duels (GDD §5.2, build plan step 2.4b): what a player has used, and what each
 * shows on the question it was used on. Effects are kept in canonical order and turned into the
 * player's own order when shown.
 */
import { askNaija, displayOrder, LIFELINES, NEW_PLAYER_RATING, toDisplayIndex } from '@whosabi/game-rules';
import type { Lifeline, QuestionLifelines } from '@whosabi/shared-types';
import type { Pool, PoolClient } from '../db';
import type { DuelQuestion } from './questions';

type Db = Pool | PoolClient;

export interface LifelineRow {
  type: Lifeline;
  round_no: number;
  seq: number;
  question_id: string;
  effect: { removed?: number[]; percents?: number[]; to?: string };
}

export async function lifelinesOf(db: Db, duelId: string, userId: string): Promise<LifelineRow[]> {
  const rows = await db.query<LifelineRow>(
    'SELECT type, round_no, seq, question_id, effect FROM duel_lifelines WHERE duel_id = $1 AND user_id = $2',
    [duelId, userId],
  );
  return rows.rows;
}

/** The lifelines block of a served question, in this player's option order (`perm`). */
export function questionLifelines(
  rows: readonly LifelineRow[],
  roundNo: number,
  seq: number,
  q: DuelQuestion,
  perm: readonly number[],
): QuestionLifelines {
  const here = (type: Lifeline) =>
    rows.find((r) => r.type === type && r.round_no === roundNo && r.seq === seq && r.question_id === q.id);
  const fifty = here('fifty')?.effect.removed;
  const percents = here('ask_naija')?.effect.percents;
  return {
    used: LIFELINES.filter((type) => rows.some((r) => r.type === type)),
    removed: fifty ? fifty.map((c) => toDisplayIndex(perm, c)).sort((a, b) => a - b) : null,
    ask_naija: percents ? displayOrder(percents, perm) : null,
  };
}

/**
 * Ask Naija's percentages (canonical order) from everyone's answers so far, filled in by an
 * imagined crowd of average players while the question is new.
 */
export async function askNaijaFor(db: Db, q: DuelQuestion): Promise<number[]> {
  const row = await db.query<{ option_counts: number[] }>(
    'SELECT option_counts FROM question_stats WHERE question_id = $1',
    [q.id],
  );
  const counts = q.options.map((_, i) => row.rows[0]?.option_counts[i] ?? 0);
  const expected = 1 / (1 + 10 ** ((q.d_rating - NEW_PLAYER_RATING.rating) / 400));
  return askNaija(counts, q.correct_index!, expected);
}
