/**
 * Re-scoring a corrected question (TRD FR-CON-7, build plan step 2.6b-2, the owner's rule of
 * 28 Oct 2026). When an editor gives a played question a different right answer, the games of
 * the last 14 days that used it are scored again, once:
 *
 * - Whoever picked the new answer gets its points (base and speed, as when they answered; no
 *   streak bonus, which would need the whole round replayed). Nobody loses any: answers right
 *   under the old key stay right.
 * - A finished duel's result changes only if the totals flip (a draw that is no longer level
 *   counts). A forfeit stays with the player who waited: it was decided by time, not points.
 *   Ratings stay as they are; they have moved on with later games.
 * - A Daily's score, grid and boards follow, and its ranks (and the week's) when already final.
 * - Each player whose games changed is told in one push; a changed duel result goes to both.
 */
import {
  DEFAULT_CONFIG,
  addDays,
  dailyGrid,
  isoWeek,
  isoWeekStart,
  scoreAnswer,
  watDate,
} from '@whosabi/game-rules';
import { recordResult } from '../daily/boards';
import { rankDaily, rankWeek } from '../daily/repo';
import { withTransaction, type PoolClient } from '../db';
import type { JobDeps } from '../jobs/deps';
import { queuePush } from '../push/queue';
import { addHistory } from './bank';

export const RESCORE_DAYS = 14;
const DAY = 86_400_000;
/** Duels and the Daily use the same answer time (TRD §5.1). */
const TIME_LIMIT_MS = DEFAULT_CONFIG['duel.timer_text_s'] * 1000;

const pointsFor = (elapsedMs: number | null) =>
  scoreAnswer({
    correct: true,
    elapsedMs: elapsedMs ?? TIME_LIMIT_MS,
    timeLimitMs: TIME_LIMIT_MS,
    streakBefore: 0,
  }).points;

interface Correction {
  id: string;
  question_id: string;
  version: number;
  new_index: number;
}

export interface RescoreResult {
  answers: number;
  duels: number;
  flipped: number;
  dailies: number;
  players: number;
}

/** What one player is told. */
interface Told {
  points: number;
  games: Set<string>;
  duelId: string | null;
  dailyId: number | null;
  result: 'won' | 'lost' | null;
  opponentId: string | null;
}

/** The worker's job: re-scores waiting corrections, oldest first. Returns how many were done. */
export async function processCorrections(deps: JobDeps, limit = 5): Promise<number> {
  let done = 0;
  while (done < limit) {
    const boards = await withTransaction(deps.pool, (client) => rescoreNext(deps, client));
    if (!boards) break;
    // Redis boards hold absolute scores, so they are set again once the new ones are saved.
    for (const entry of boards) await recordResult(deps.pool, deps.redis, entry);
    done++;
  }
  return done;
}

type BoardEntry = Parameters<typeof recordResult>[2];

async function rescoreNext(deps: JobDeps, client: PoolClient): Promise<BoardEntry[] | null> {
  const now = deps.clock.now();
  const correction = (
    await client.query<Correction>(
      `SELECT id, question_id, version, new_index FROM question_corrections
        WHERE done_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    )
  ).rows[0];
  if (!correction) return null;

  const told = new Map<string, Told>();
  const tell = (userId: string): Told => {
    let t = told.get(userId);
    if (!t) {
      t = { points: 0, games: new Set(), duelId: null, dailyId: null, result: null, opponentId: null };
      told.set(userId, t);
    }
    return t;
  };

  const duels = await rescoreDuels(client, correction, now, tell);
  const { dailies, boards, answers: dailyAnswers } = await rescoreDailies(client, correction, now, tell);

  const names = await usernames(
    client,
    [...told.values()].flatMap((t) => (t.opponentId ? [t.opponentId] : [])),
  );
  for (const [userId, t] of told) {
    const single = t.games.size === 1;
    await queuePush(client, {
      userId,
      params: {
        type: 'content_correction',
        points: t.points,
        games: t.games.size,
        duel_id: t.result || single ? t.duelId : null,
        daily_id: single && !t.duelId ? t.dailyId : null,
        result: t.result,
        opponent: t.opponentId ? (names.get(t.opponentId) ?? null) : null,
      },
      collapseKey: `correction:${correction.id}`,
      expiresAt: now + 3 * DAY,
      now,
    });
  }

  const result: RescoreResult = {
    answers: duels.answers + dailyAnswers,
    duels: duels.duels,
    flipped: duels.flipped,
    dailies,
    players: told.size,
  };
  await client.query('UPDATE question_corrections SET done_at = $2, result = $3 WHERE id = $1', [
    correction.id,
    new Date(now),
    JSON.stringify(result),
  ]);
  await addHistory(client, {
    questionId: correction.question_id,
    action: 'rescored',
    actor: 'system',
    note: summary(result),
    version: correction.version,
    at: now,
  });
  return boards;
}

function summary(r: RescoreResult): string {
  if (r.answers === 0) return 'No games from the last 14 days had the new answer picked.';
  const parts = [`${r.answers} ${r.answers === 1 ? 'answer' : 'answers'} now right`];
  if (r.duels > 0) {
    parts.push(
      `${r.duels} ${r.duels === 1 ? 'duel' : 'duels'}${r.flipped > 0 ? ` (${r.flipped} with a new result)` : ''}`,
    );
  }
  if (r.dailies > 0) parts.push(`${r.dailies} Daily ${r.dailies === 1 ? 'result' : 'results'}`);
  return `${parts.join(', ')}; ${r.players} ${r.players === 1 ? 'player' : 'players'} told.`;
}

async function rescoreDuels(
  client: PoolClient,
  c: Correction,
  now: number,
  tell: (userId: string) => Told,
): Promise<{ answers: number; duels: number; flipped: number }> {
  const window = [c.question_id, c.new_index, new Date(now - RESCORE_DAYS * DAY)];
  const match = `da.question_id = $1 AND da.chosen_index = $2 AND NOT da.correct AND da.round_no <= 3
                 AND da.served_at >= $3`;
  // Duel rows first, then their answers: the same order as playing a duel, so neither waits on
  // the other in a circle.
  const ids = (
    await client.query<{ duel_id: string }>(
      `SELECT DISTINCT da.duel_id FROM duel_answers da WHERE ${match}`,
      window,
    )
  ).rows.map((r) => r.duel_id);
  if (ids.length === 0) return { answers: 0, duels: 0, flipped: 0 };
  await client.query(
    "SELECT id FROM duels WHERE id = ANY($1) AND state <> 'cancelled' ORDER BY id FOR UPDATE",
    [ids],
  );
  const answers = (
    await client.query<{
      duel_id: string;
      round_no: number;
      seq: number;
      user_id: string;
      accepted_elapsed_ms: number | null;
    }>(
      `SELECT da.duel_id, da.round_no, da.seq, da.user_id, da.accepted_elapsed_ms
         FROM duel_answers da JOIN duels d ON d.id = da.duel_id
        WHERE ${match} AND d.state <> 'cancelled'
        ORDER BY da.duel_id, da.round_no, da.seq, da.user_id
          FOR UPDATE OF da`,
      window,
    )
  ).rows;
  if (answers.length === 0) return { answers: 0, duels: 0, flipped: 0 };

  const gains = new Map<string, Map<string, number>>(); // duel → player → points
  for (const a of answers) {
    const points = pointsFor(a.accepted_elapsed_ms);
    await client.query(
      `UPDATE duel_answers SET correct = true, points = $5
        WHERE duel_id = $1 AND round_no = $2 AND seq = $3 AND user_id = $4`,
      [a.duel_id, a.round_no, a.seq, a.user_id, points],
    );
    const byPlayer = gains.get(a.duel_id) ?? new Map<string, number>();
    byPlayer.set(a.user_id, (byPlayer.get(a.user_id) ?? 0) + points);
    gains.set(a.duel_id, byPlayer);
  }

  let flipped = 0;
  const duels = (
    await client.query<{
      id: string;
      player_a: string;
      player_b: string | null;
      state: string;
      score_a: number;
      score_b: number;
      winner_id: string | null;
    }>(
      'SELECT id, player_a, player_b, state, score_a, score_b, winner_id FROM duels WHERE id = ANY($1) ORDER BY id',
      [[...gains.keys()]],
    )
  ).rows;
  for (const duel of duels) {
    const byPlayer = gains.get(duel.id)!;
    const scoreA = duel.score_a + (byPlayer.get(duel.player_a) ?? 0);
    const scoreB = duel.score_b + (duel.player_b ? (byPlayer.get(duel.player_b) ?? 0) : 0);
    let winner = duel.winner_id;
    // Only points decide again: a forfeit was decided by time.
    if (duel.state === 'complete' && duel.player_b && scoreA !== scoreB) {
      winner = scoreA > scoreB ? duel.player_a : duel.player_b;
    }
    await client.query('UPDATE duels SET score_a = $2, score_b = $3, winner_id = $4 WHERE id = $1', [
      duel.id,
      scoreA,
      scoreB,
      winner,
    ]);
    for (const [userId, points] of byPlayer) {
      const t = tell(userId);
      t.points += points;
      t.games.add(`duel:${duel.id}`);
      if (!t.result) {
        t.duelId = duel.id;
        t.opponentId = userId === duel.player_a ? duel.player_b : duel.player_a;
      }
    }
    if (winner !== duel.winner_id && duel.player_b) {
      flipped++;
      for (const userId of [duel.player_a, duel.player_b]) {
        const t = tell(userId);
        t.games.add(`duel:${duel.id}`);
        t.result = userId === winner ? 'won' : 'lost';
        t.duelId = duel.id;
        t.opponentId = userId === duel.player_a ? duel.player_b : duel.player_a;
      }
    }
  }
  return { answers: answers.length, duels: duels.length, flipped };
}

interface StoredDailyAnswer {
  qid: string;
  picked: number | null;
  ms: number;
  correct: boolean;
  points: number;
}

async function rescoreDailies(
  client: PoolClient,
  c: Correction,
  now: number,
  tell: (userId: string) => Told,
): Promise<{ dailies: number; answers: number; boards: BoardEntry[] }> {
  const rows = (
    await client.query<{
      daily_id: number;
      user_id: string;
      answers: StoredDailyAnswer[];
      play_date: string;
      snapshot_at: Date | null;
      home_state: string | null;
    }>(
      `SELECT dr.daily_id, dr.user_id, dr.answers, to_char(dc.play_date, 'YYYY-MM-DD') AS play_date,
              dc.snapshot_at, dr.home_state
         FROM daily_results dr JOIN daily_challenges dc ON dc.id = dr.daily_id
        WHERE $1 = ANY(dc.question_ids) AND dc.play_date >= $2::date AND dr.answers IS NOT NULL
        ORDER BY dr.daily_id, dr.user_id
          FOR UPDATE OF dr`,
      [c.question_id, addDays(watDate(now), -RESCORE_DAYS)],
    )
  ).rows;

  let answers = 0;
  const changedDailies = new Set<number>();
  const changedWeeks = new Set<string>();
  const boards: BoardEntry[] = [];
  for (const row of rows) {
    const index = row.answers.findIndex((a) => a.qid === c.question_id);
    const answer = row.answers[index];
    if (!answer || answer.correct || answer.picked !== c.new_index) continue;
    const points = pointsFor(answer.ms);
    const updated = row.answers.map((a, i) => (i === index ? { ...a, correct: true, points } : a));
    await client.query(
      `UPDATE daily_results SET answers = $3, score = score + $4, correct_count = correct_count + 1, grid = $5
        WHERE daily_id = $1 AND user_id = $2`,
      [row.daily_id, row.user_id, JSON.stringify(updated), points, dailyGrid(updated.map((a) => a.correct))],
    );
    answers++;
    if (row.snapshot_at) changedDailies.add(row.daily_id);
    const week = isoWeek(row.play_date);
    const standing = await client.query(
      'UPDATE weekly_standings SET score = score + $3 WHERE iso_week = $1 AND user_id = $2',
      [week, row.user_id, points],
    );
    if ((standing.rowCount ?? 0) > 0) changedWeeks.add(week);
    boards.push({
      userId: row.user_id,
      date: row.play_date,
      week,
      weekStart: isoWeekStart(row.play_date),
      state: row.home_state,
    });
    const t = tell(row.user_id);
    t.points += points;
    t.games.add(`daily:${row.daily_id}`);
    t.dailyId = row.daily_id;
  }
  for (const id of changedDailies) await rankDaily(client, id);
  for (const week of changedWeeks) await rankWeek(client, week);
  return { dailies: answers, answers, boards };
}

async function usernames(client: PoolClient, ids: readonly string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await client.query<{ id: string; username: string | null }>(
    'SELECT id, username FROM users WHERE id = ANY($1)',
    [[...new Set(ids)]],
  );
  return new Map(rows.rows.map((r) => [r.id, r.username]));
}
