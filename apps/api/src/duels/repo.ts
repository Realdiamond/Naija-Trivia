/**
 * Duel rows (doc 08: `duels`, `duel_rounds`, `duel_answers`). Postgres is the record: turns
 * last up to 48 h, so nothing about a duel lives only in Redis. Times are written from the
 * app's clock, never the database's `now()`, so tests control them exactly.
 */
import type { DuelSide, DuelSnapshot, DuelState } from '@whosabi/game-rules';
import type { DuelSource, Platform } from '@whosabi/shared-types';
import type { Pool, PoolClient } from '../db';

type Db = Pool | PoolClient;

export const ACTIVE_STATES: readonly DuelState[] = [
  'created',
  'wait_b_r1r2',
  'wait_a_r2r3',
  'wait_b_r3',
  'tiebreak',
];
export const FINISHED_STATES: readonly DuelState[] = ['complete', 'forfeit', 'declined', 'cancelled'];

/**
 * The Sabi Bot (TRD FR-DUEL-6, migration 0018): it takes seat B of a random duel nobody joined
 * within a minute. Its duels are unrated, and it gets no pushes, events or seen questions.
 */
export const SABI_BOT_ID = 'u_sabi_bot';

export interface DuelRow {
  id: string;
  player_a: string;
  player_b: string | null;
  invite_token: string | null;
  source: DuelSource;
  state: DuelState;
  turn_user_id: string | null;
  turn_deadline: Date | null;
  score_a: number;
  score_b: number;
  winner_id: string | null;
  rating_delta_a: number | null;
  rating_delta_b: number | null;
  /** What each player got once the duel finished (step 2.4a). */
  coins_a: number | null;
  coins_b: number | null;
  xp_a: number | null;
  xp_b: number | null;
  rematch_of: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface RoundRow {
  duel_id: string;
  round_no: number;
  category_id: string | null;
  picked_by: string | null;
  offered: string[];
  question_ids: string[];
}

export interface AnswerRow {
  duel_id: string;
  round_no: number;
  seq: number;
  user_id: string;
  question_id: string;
  served_at: Date;
  received_at: Date | null;
  client_elapsed_ms: number | null;
  accepted_elapsed_ms: number | null;
  rtt_est_ms: number | null;
  display_index: number | null;
  chosen_index: number | null;
  correct: boolean | null;
  points: number;
  platform: Platform | null;
  tab_hidden_ms: number | null;
  guess: number | null;
  idempotency_key: string | null;
  /** The lifeline used on this question, if any (step 2.4b). */
  lifeline: string | null;
  /** Extra Time's 10 s. */
  extra_ms: number;
}

export interface PlayerRow {
  id: string;
  username: string | null;
  level: number;
  status: string;
  family_mode: boolean;
  last_platform: Platform | null;
}

export function sideOf(duel: DuelRow, userId: string): DuelSide | null {
  if (duel.player_a === userId) return 'a';
  if (duel.player_b !== null && duel.player_b === userId) return 'b';
  return null;
}

/** The people in a duel: the Sabi Bot is left out. */
export function humansOf(duel: DuelRow): string[] {
  return [duel.player_a, duel.player_b].filter((id): id is string => id !== null && id !== SABI_BOT_ID);
}

export function playerFor(duel: DuelRow, side: DuelSide | null): string | null {
  return side === 'a' ? duel.player_a : side === 'b' ? duel.player_b : null;
}

export function snapshotOf(duel: DuelRow): DuelSnapshot {
  return {
    state: duel.state,
    scoreA: duel.score_a,
    scoreB: duel.score_b,
    opponentJoined: duel.player_b !== null,
    winner: duel.winner_id === null ? null : duel.winner_id === duel.player_a ? 'a' : 'b',
  };
}

export function isDue(duel: DuelRow, now: number): boolean {
  return (
    ACTIVE_STATES.includes(duel.state) && duel.turn_deadline !== null && duel.turn_deadline.getTime() <= now
  );
}

export async function lockDuel(client: PoolClient, id: string): Promise<DuelRow | null> {
  const result = await client.query<DuelRow>('SELECT * FROM duels WHERE id = $1 FOR UPDATE', [id]);
  return result.rows[0] ?? null;
}

export async function getDuel(db: Db, id: string): Promise<DuelRow | null> {
  const result = await db.query<DuelRow>('SELECT * FROM duels WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function getRounds(db: Db, duelIds: readonly string[]): Promise<RoundRow[]> {
  if (duelIds.length === 0) return [];
  const result = await db.query<RoundRow>(
    'SELECT * FROM duel_rounds WHERE duel_id = ANY($1) ORDER BY duel_id, round_no',
    [duelIds],
  );
  return result.rows;
}

export async function getAnswers(db: Db, duelIds: readonly string[]): Promise<AnswerRow[]> {
  if (duelIds.length === 0) return [];
  const result = await db.query<AnswerRow & { guess: string | null }>(
    'SELECT * FROM duel_answers WHERE duel_id = ANY($1) ORDER BY duel_id, round_no, seq, user_id',
    [duelIds],
  );
  // numeric arrives as a string from pg.
  return result.rows.map((row) => ({ ...row, guess: row.guess === null ? null : Number(row.guess) }));
}

export async function getPlayers(db: Db, ids: readonly string[]): Promise<Map<string, PlayerRow>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<PlayerRow>(
    'SELECT id, username, level, status, family_mode, last_platform FROM users WHERE id = ANY($1)',
    [ids],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

/** Duels a player is still in (PRD US-3 AC4 caps these). */
export async function activeDuelCount(db: Db, userId: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM duels
      WHERE (player_a = $1 OR player_b = $1) AND state = ANY($2::duel_state[])`,
    [userId, ACTIVE_STATES],
  );
  return result.rows[0]!.n;
}

/** Serialises duel creation per player, so two quick requests can't both pass the active-duel cap. */
export async function lockPlayers(client: PoolClient, ids: readonly string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('duels:' || $1))", [id]);
  }
}

/** A player's answered rows in rounds 1–3, in play order. */
export function playedRows(answers: readonly AnswerRow[], userId: string): AnswerRow[] {
  return answers
    .filter((a) => a.user_id === userId && a.round_no <= 3 && a.received_at !== null)
    .sort((x, y) => x.round_no - y.round_no || x.seq - y.seq);
}

export function roundFinished(round: RoundRow | undefined, answers: readonly AnswerRow[], userId: string) {
  if (!round || round.question_ids.length === 0) return false;
  const answered = answers.filter(
    (a) => a.user_id === userId && a.round_no === round.round_no && a.received_at !== null,
  ).length;
  return answered === round.question_ids.length;
}
