/**
 * The Daily Sabi Challenge (PRD US-8, TRD §4.5, doc 09 §2.6): the same 7 questions for everyone
 * from 00:00 to 23:59 WAT, played once through the solo serve → answer flow. The 7th answer
 * records the result, the streak (one freeze a week) and XP, and puts the player on the day's
 * and the week's boards. The worker picks tomorrow's at 23:00 WAT and saves final ranks.
 */
import type { FastifyRequest } from 'fastify';
import {
  addDays,
  dailyGrid,
  dailyShareText,
  dailyXp,
  DEFAULT_CONFIG,
  isoWeek,
  isoWeekStart,
  levelForXp,
  NEW_PLAYER_RATING,
  percentBeaten,
  pointsFromBoardScore,
  recordDailyPlay,
  streakOn,
  tierForRating,
  watDate,
} from '@whosabi/game-rules';
import {
  ErrorCode,
  type AnswerRequest,
  type DailyAnswerResponse,
  type DailyResult,
  type DailyToday,
  type HomeState,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type LeaderboardScope,
  type ServedQuestion,
} from '@whosabi/shared-types';
import { raiseStaffAlert } from '../admin/alerts';
import type { AppDeps } from '../app';
import { withTransaction } from '../db';
import { ApiError, conflict, notFound } from '../errors';
import { requestEventContext, type EventContext } from '../events';
import { answerSolo, serveSolo, type SoloRound } from '../rounds/solo';
import { RoundStore, type StoredAnswer } from '../rounds/store';
import {
  countBelow,
  ensureDailyBoard,
  ensureWeekBoard,
  positionOf,
  recordResult,
  topOf,
  type Board,
  type Ranked,
} from './boards';
import {
  dailyById,
  dailyByDate,
  dailyResultFor,
  ensureDaily,
  loadStreak,
  rankDaily,
  saveStreak,
  type DailyRow,
} from './repo';

export type DailyDeps = Pick<AppDeps, 'config' | 'pool' | 'redis' | 'clock' | 'events' | 'log'>;

const HOUR = 3_600_000;
/** A Daily's answers stay in Redis for two days: the whole day plus a late finish. */
const ROUND_TTL_S = 48 * 3600;
const TOP = 100;
/** A state leads the day only with this many players (GDD §2.3, "Anambra dey lead today"). */
const LEADING_STATE_MIN_PLAYERS = 3;
/** Ranks are saved this long after midnight, once answers sent just before it are in. */
const SNAPSHOT_DELAY_MS = 10 * 60_000;

/** Midnight WAT at the end of `date`. */
function endOfDay(date: string): Date {
  return new Date(Date.parse(`${addDays(date, 1)}T00:00:00Z`) - HOUR);
}

export class DailyService {
  private readonly store: RoundStore;

  constructor(private readonly deps: DailyDeps) {
    this.store = new RoundStore(deps.redis, ROUND_TTL_S);
  }

  private today(): string {
    return watDate(this.deps.clock.now());
  }

  private round(daily: DailyRow, userId: string): SoloRound {
    return {
      id: `daily:${daily.id}:${userId}`,
      userId,
      mode: 'daily',
      questionIds: daily.question_ids,
      timeLimitMs: DEFAULT_CONFIG['duel.timer_text_s'] * 1000,
    };
  }

  private async categoriesOf(daily: DailyRow): Promise<string[]> {
    const rows = await this.deps.pool.query<{ id: string; category_id: string }>(
      'SELECT id, category_id FROM questions WHERE id = ANY($1)',
      [daily.question_ids],
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.category_id]));
    return daily.question_ids.map((id) => byId.get(id) ?? 'mixed');
  }

  async todayFor(userId: string): Promise<DailyToday> {
    const date = this.today();
    const daily = await ensureDaily(this.deps.pool, this.deps.log, date);
    if (!daily) {
      throw new ApiError(503, ErrorCode.noQuestions, "Today's Daily is not ready", 'Try again soon.');
    }
    const [result, answers, streak, categories] = await Promise.all([
      dailyResultFor(this.deps.pool, daily.id, userId),
      this.store.answers(this.round(daily, userId).id, daily.question_ids.length),
      loadStreak(this.deps.pool, userId),
      this.categoriesOf(daily),
    ]);
    const view = streakOn(streak, date);
    return {
      id: daily.id,
      date,
      total: daily.question_ids.length,
      categories,
      played: result !== null,
      answered: result ? daily.question_ids.length : answers.filter((a) => a !== null).length,
      streak: { current: view.current, best: view.best, freezes_left: view.freezesLeft },
      closes_at: endOfDay(date).toISOString(),
    };
  }

  /** Today's Daily only, and once: the past is closed and the future does not exist yet. */
  private async playable(dailyId: number): Promise<DailyRow> {
    const daily = await dailyById(this.deps.pool, dailyId);
    const today = this.today();
    if (!daily || daily.play_date > today) throw notFound('There is no Daily with this number.');
    if (daily.play_date < today) {
      throw conflict(ErrorCode.dailyClosed, 'This Daily has ended', "Today's Daily is waiting for you.");
    }
    return daily;
  }

  async serve(
    dailyId: number,
    seq: number,
    userId: string,
    request: FastifyRequest,
  ): Promise<ServedQuestion> {
    const daily = await this.playable(dailyId);
    if (await dailyResultFor(this.deps.pool, daily.id, userId)) {
      throw conflict(
        ErrorCode.dailyAlreadyPlayed,
        'You have played this Daily',
        'Come back tomorrow for the next.',
      );
    }
    const { served, first } = await serveSolo(this.deps, this.store, this.round(daily, userId), seq, request);
    if (first && seq === 1) {
      await this.deps.events.emit('daily_started', { daily_id: daily.id }, requestEventContext(request));
    }
    return served;
  }

  async answer(
    dailyId: number,
    seq: number,
    body: AnswerRequest,
    userId: string,
    request: FastifyRequest,
  ): Promise<DailyAnswerResponse> {
    const daily = await dailyById(this.deps.pool, dailyId);
    // An answer to a question shown before midnight may arrive just after it (FR-DUEL-5).
    if (!daily || daily.play_date > this.today()) throw notFound('There is no Daily with this number.');
    if (daily.play_date < addDays(this.today(), -1)) {
      throw conflict(ErrorCode.dailyClosed, 'This Daily has ended', "Today's Daily is waiting for you.");
    }
    const { response, answers } = await answerSolo(
      this.deps,
      this.store,
      this.round(daily, userId),
      seq,
      body,
      request,
    );
    const finished = answers.every((a) => a !== null);
    if (finished) await this.finish(daily, userId, answers as StoredAnswer[], requestEventContext(request));
    return { ...response, finished };
  }

  /**
   * Records the result once: the row, the streak and XP in one transaction, then the boards and
   * `daily_completed`. Safe to call again (a retried last answer, or the result screen).
   */
  private async finish(daily: DailyRow, userId: string, answers: StoredAnswer[], ctx: EventContext) {
    const { pool, redis, clock } = this.deps;
    const correct = answers.filter((a) => a.correct).length;
    const score = answers.reduce((sum, a) => sum + a.points, 0);
    const totalMs = answers.reduce((sum, a) => sum + a.acceptedMs, 0);
    const xp = dailyXp(correct, answers.length);
    const now = clock.now();

    const recorded = await withTransaction(pool, async (client) => {
      const user = (
        await client.query<{ home_state: string | null; xp: string }>(
          'SELECT home_state, xp FROM users WHERE id = $1 FOR UPDATE',
          [userId],
        )
      ).rows[0];
      if (!user) return null;
      const inserted = await client.query(
        `INSERT INTO daily_results (daily_id, user_id, correct_count, score, total_ms, grid, home_state, completed_at, xp,
                                    answers)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING RETURNING daily_id`,
        [
          daily.id,
          userId,
          correct,
          score,
          totalMs,
          dailyGrid(answers.map((a) => a.correct)),
          user.home_state,
          new Date(now),
          xp,
          // Kept for re-scoring a corrected question (step 2.6b-2).
          JSON.stringify(
            answers.map((a) => ({
              qid: a.qid,
              picked: a.canonicalIndex,
              ms: a.acceptedMs,
              correct: a.correct,
              points: a.points,
            })),
          ),
        ],
      );
      if (inserted.rowCount === 0) return null;
      const { state, usedFreeze } = recordDailyPlay(await loadStreak(client, userId, true), daily.play_date);
      await saveStreak(client, userId, state);
      await client.query(
        'UPDATE daily_results SET streak = $3, used_freeze = $4 WHERE daily_id = $1 AND user_id = $2',
        [daily.id, userId, state.current, usedFreeze],
      );
      const total = Number(user.xp) + xp;
      await client.query('UPDATE users SET xp = $2, level = $3, updated_at = $4 WHERE id = $1', [
        userId,
        total,
        levelForXp(total).level,
        new Date(now),
      ]);
      return { streak: state.current };
    });

    const result = await dailyResultFor(pool, daily.id, userId);
    if (result) {
      await recordResult(pool, redis, {
        userId,
        date: daily.play_date,
        week: isoWeek(daily.play_date),
        weekStart: isoWeekStart(daily.play_date),
        state: result.home_state,
      });
    }
    if (recorded) {
      await this.deps.events.emit(
        'daily_completed',
        { daily_id: daily.id, score, streak: recorded.streak },
        ctx,
      );
    }
  }

  async result(dailyId: number, userId: string, request: FastifyRequest): Promise<DailyResult> {
    const { pool, redis, config } = this.deps;
    const daily = await dailyById(pool, dailyId);
    if (!daily || daily.play_date > this.today()) throw notFound('There is no Daily with this number.');
    let row = await dailyResultFor(pool, daily.id, userId);
    if (!row) {
      // The last answer was saved but recording it failed: finish it now.
      const answers = await this.store.answers(this.round(daily, userId).id, daily.question_ids.length);
      if (answers.every((a) => a !== null)) {
        await this.finish(daily, userId, answers as StoredAnswer[], requestEventContext(request));
        row = await dailyResultFor(pool, daily.id, userId);
      }
    }
    if (!row) throw conflict(ErrorCode.dailyNotFinished, 'Finish the Daily first');

    const board = await ensureDailyBoard(pool, redis, daily.id, daily.play_date);
    const me = await positionOf(redis, board.key, userId);
    const players = await redis.zcard(board.key);
    const below = me ? await countBelow(redis, board.key, me.value) : 0;
    const statePosition = row.home_state
      ? await positionOf(redis, board.stateKey(row.home_state), userId)
      : null;
    const [statePlayers, leading, streak, review] = await Promise.all([
      row.home_state ? redis.zcard(board.stateKey(row.home_state)) : Promise.resolve(0),
      this.leadingState(daily, players),
      loadStreak(pool, userId),
      this.review(daily, row.grid),
    ]);
    const view = streakOn(streak, this.today());
    const shareUrl = `${config.publicWebUrl}/daily/${daily.id}`;
    return {
      id: daily.id,
      date: daily.play_date,
      total: daily.question_ids.length,
      correct_count: row.correct_count,
      score: row.score,
      total_ms: row.total_ms,
      grid: row.grid,
      categories: review.map((r) => r.category_id),
      percentile: percentBeaten(below, players),
      players,
      state:
        row.home_state && statePosition
          ? { code: row.home_state as HomeState, rank: statePosition.rank, players: statePlayers }
          : null,
      leading_state: leading,
      streak: {
        current: row.streak,
        best: view.best,
        freezes_left: view.freezesLeft,
        used_freeze: row.used_freeze,
      },
      xp: row.xp,
      share_text: dailyShareText({
        number: daily.id,
        correct: row.correct_count,
        total: daily.question_ids.length,
        totalMs: row.total_ms,
        grid: row.grid,
        streak: row.streak,
        url: shareUrl.replace(/^https?:\/\//, ''),
      }),
      share_url: shareUrl,
      review,
    };
  }

  /**
   * The state with the best average score that day, among states with enough players. Cached per
   * player count, so it is worked out again once someone new finishes.
   */
  private async leadingState(daily: DailyRow, players: number): Promise<HomeState | null> {
    const key = `lb:daily:${daily.play_date.replaceAll('-', '')}:leader:${players}`;
    const cached = await this.deps.redis.get(key);
    if (cached !== null) return (cached || null) as HomeState | null;
    const result = await this.deps.pool.query<{ home_state: string }>(
      `SELECT home_state FROM daily_results
        WHERE daily_id = $1 AND home_state IS NOT NULL
        GROUP BY home_state HAVING count(*) >= $2
        ORDER BY avg(score) DESC, count(*) DESC, home_state LIMIT 1`,
      [daily.id, LEADING_STATE_MIN_PLAYERS],
    );
    const leader = result.rows[0]?.home_state ?? null;
    await this.deps.redis.set(key, leader ?? '', 'EX', 60);
    return leader as HomeState | null;
  }

  private async review(daily: DailyRow, grid: string): Promise<DailyResult['review']> {
    const rows = await this.deps.pool.query<{
      id: string;
      category_id: string;
      text: string;
      options: string[];
      correct_index: number;
      fact: string | null;
    }>('SELECT id, category_id, text, options, correct_index, fact FROM questions WHERE id = ANY($1)', [
      daily.question_ids,
    ]);
    const byId = new Map(rows.rows.map((r) => [r.id, r]));
    return daily.question_ids.flatMap((id, i) => {
      const q = byId.get(id);
      if (!q) return [];
      return [
        {
          seq: i + 1,
          category_id: q.category_id,
          text: q.text,
          answer: q.options[q.correct_index] ?? '',
          correct: grid[i] === 'G',
          fact: q.fact,
        },
      ];
    });
  }

  // ----- Leaderboards -----

  async dailyLeaderboard(
    dailyId: number,
    scope: LeaderboardScope,
    userId: string,
  ): Promise<LeaderboardResponse> {
    const daily = await dailyById(this.deps.pool, dailyId);
    if (!daily || daily.play_date > this.today()) throw notFound('There is no Daily with this number.');
    const base = { board: 'daily' as const, period: String(daily.id), resets_at: endOfDay(daily.play_date) };
    if (scope === 'friends') return this.friendsBoard([daily.id], base, userId);
    const board = await ensureDailyBoard(this.deps.pool, this.deps.redis, daily.id, daily.play_date);
    return this.redisBoard(board, scope, base, userId, pointsFromBoardScore);
  }

  async weekLeaderboard(scope: LeaderboardScope, userId: string): Promise<LeaderboardResponse> {
    const today = this.today();
    const start = isoWeekStart(today);
    const week = isoWeek(today);
    const base = { board: 'week' as const, period: week, resets_at: endOfDay(addDays(start, 6)) };
    if (scope === 'friends') {
      const ids = await this.deps.pool.query<{ id: number }>(
        'SELECT id FROM daily_challenges WHERE play_date >= $1::date AND play_date < $2::date',
        [start, addDays(start, 7)],
      );
      return this.friendsBoard(
        ids.rows.map((r) => r.id),
        base,
        userId,
      );
    }
    const board = await ensureWeekBoard(this.deps.pool, this.deps.redis, week, start);
    return this.redisBoard(board, scope, base, userId, (v) => v);
  }

  private async redisBoard(
    board: Board,
    scope: 'global' | 'state',
    base: { board: 'daily' | 'week'; period: string; resets_at: Date },
    userId: string,
    points: (value: number) => number,
  ): Promise<LeaderboardResponse> {
    const { redis } = this.deps;
    let state: string | null = null;
    if (scope === 'state') {
      state =
        (
          await this.deps.pool.query<{ home_state: string | null }>(
            'SELECT home_state FROM users WHERE id = $1',
            [userId],
          )
        ).rows[0]?.home_state ?? null;
      if (!state) return { ...this.head(base, scope, null), players: 0, entries: [], me: null };
    }
    const key = state ? board.stateKey(state) : board.key;
    const [top, mine, players] = await Promise.all([
      topOf(redis, key, TOP),
      positionOf(redis, key, userId),
      redis.zcard(key),
    ]);
    const lines = (ranked: Ranked[]) =>
      ranked.map((r) => ({ userId: r.userId, rank: r.rank, score: points(r.value) }));
    // Your own line comes along when you are below the top 100.
    const below = mine && mine.rank > TOP ? [mine] : [];
    const entries = await this.entries(lines([...top, ...below]), userId, true);
    return {
      ...this.head(base, scope, state),
      players,
      entries: entries.filter((e) => e.rank <= TOP),
      me: entries.find((e) => e.you) ?? null,
    };
  }

  /** Friends and yourself, from Postgres: friends lists are short and change all the time. */
  private async friendsBoard(
    dailyIds: number[],
    base: { board: 'daily' | 'week'; period: string; resets_at: Date },
    userId: string,
  ): Promise<LeaderboardResponse> {
    const rows = await this.deps.pool.query<{ user_id: string; score: number }>(
      `WITH people AS (
         SELECT $1::text AS id
         UNION
         SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END FROM friendships
          WHERE (user_a = $1 OR user_b = $1) AND status = 'accepted')
       SELECT dr.user_id, sum(dr.score)::int AS score
         FROM daily_results dr JOIN people p ON p.id = dr.user_id
        WHERE dr.daily_id = ANY($2)
        GROUP BY dr.user_id
        ORDER BY sum(dr.score) DESC, sum(dr.total_ms), dr.user_id`,
      [userId, dailyIds],
    );
    const lines = rows.rows.map((r, i) => ({ userId: r.user_id, rank: i + 1, score: r.score }));
    const entries = await this.entries(lines, userId, false);
    return {
      ...this.head(base, 'friends', null),
      players: entries.length,
      entries: entries.slice(0, TOP),
      me: entries.find((e) => e.you) ?? null,
    };
  }

  private head(
    base: { board: 'daily' | 'week'; period: string; resets_at: Date },
    scope: LeaderboardScope,
    state: string | null,
  ) {
    return {
      board: base.board,
      period: base.period,
      scope,
      state: state as HomeState | null,
      resets_at: base.resets_at.toISOString(),
    };
  }

  /**
   * Board lines with names. On public boards, guests and 13–17s show without a name or avatar
   * (doc 10 §3.3: "Player from Lagos"); friends see each other's names. Banned and deleted
   * players drop out.
   */
  private async entries(
    lines: Array<{ userId: string; rank: number; score: number }>,
    viewer: string,
    publicBoard: boolean,
  ): Promise<LeaderboardEntry[]> {
    if (lines.length === 0) return [];
    const users = await this.deps.pool.query<{
      id: string;
      username: string | null;
      avatar_id: string | null;
      status: string;
      home_state: string | null;
      xp: string;
      rating: number | null;
    }>(
      `SELECT u.id, u.username, u.avatar_id, u.status, u.home_state, u.xp, r.rating
         FROM users u LEFT JOIN ratings r ON r.user_id = u.id AND r.scope = 'overall'
        WHERE u.id = ANY($1) AND u.status IN ('guest', 'active', 'restricted')`,
      [[...new Set(lines.map((l) => l.userId))]],
    );
    const byId = new Map(users.rows.map((u) => [u.id, u]));
    return lines.flatMap((line) => {
      const u = byId.get(line.userId);
      if (!u) return [];
      const tier = tierForRating(u.rating ?? NEW_PLAYER_RATING.rating);
      const kind = u.status === 'guest' ? 'guest' : u.status === 'restricted' ? 'restricted' : 'player';
      const named = kind === 'player' || (kind === 'restricted' && !publicBoard);
      return [
        {
          rank: line.rank,
          kind,
          username: named ? u.username : null,
          avatar_id: named ? u.avatar_id : null,
          home_state: u.home_state as HomeState | null,
          level: levelForXp(Number(u.xp)).level,
          tier: { id: tier.id, name: tier.name, badge: tier.badge },
          score: line.score,
          you: line.userId === viewer,
        } satisfies LeaderboardEntry,
      ];
    });
  }

  // ----- Worker jobs -----

  /** Today's Daily, and from 23:00 WAT tomorrow's, picked and locked (FR-DAILY-1). Returns how many were made. */
  async schedule(): Promise<number> {
    const { pool, log, clock } = this.deps;
    const now = clock.now();
    const today = watDate(now);
    let made = 0;
    // No Daily could be picked (too few live questions): staff hear about it once per date.
    const missing = (date: string, when: string) =>
      raiseStaffAlert(pool, {
        kind: 'problem',
        title: `No Daily for ${when}`,
        body: `Too few live questions to pick the Daily for ${date}. Publish more questions in the console.`,
        dedupeKey: `daily_missing:${date}`,
        now,
      });
    if (!(await dailyByDate(pool, today))) {
      if (await ensureDaily(pool, log, today)) made++;
      else await missing(today, 'today');
    }
    if (new Date(now + HOUR).getUTCHours() >= 23) {
      const tomorrow = addDays(today, 1);
      if (!(await dailyByDate(pool, tomorrow))) {
        if (await ensureDaily(pool, log, tomorrow)) made++;
        else await missing(tomorrow, 'tomorrow');
      }
      await pool.query('UPDATE daily_challenges SET locked = true WHERE play_date = $1 AND NOT locked', [
        tomorrow,
      ]);
    }
    return made;
  }

  /**
   * The nightly snapshot (TRD §5.5): final ranks on each finished Daily's results, and last
   * week's standings once the week is over. Each is written once, however many workers run.
   */
  async snapshot(): Promise<number> {
    const { pool, clock } = this.deps;
    const now = clock.now();
    const settled = watDate(now - SNAPSHOT_DELAY_MS);
    let saved = 0;
    const due = await pool.query<{ id: number }>(
      `SELECT id FROM daily_challenges WHERE play_date < $1 AND snapshot_at IS NULL ORDER BY id LIMIT 5`,
      [settled],
    );
    for (const { id } of due.rows) {
      const done = await withTransaction(pool, async (client) => {
        const claimed = await client.query(
          'SELECT 1 FROM daily_challenges WHERE id = $1 AND snapshot_at IS NULL FOR UPDATE SKIP LOCKED',
          [id],
        );
        if (claimed.rowCount === 0) return false;
        await rankDaily(client, id);
        await client.query('UPDATE daily_challenges SET snapshot_at = $2 WHERE id = $1', [id, new Date(now)]);
        return true;
      });
      if (done) saved++;
    }

    const lastWeekStart = addDays(isoWeekStart(settled), -7);
    const lastWeek = isoWeek(lastWeekStart);
    const weekly = await pool.query(
      `INSERT INTO weekly_standings (iso_week, user_id, score, dailies, home_state, rank, state_rank)
       SELECT $1, user_id, score, dailies, home_state,
              row_number() OVER (ORDER BY score DESC, user_id),
              CASE WHEN home_state IS NULL THEN NULL ELSE
                row_number() OVER (PARTITION BY home_state ORDER BY score DESC, user_id) END
         FROM (SELECT dr.user_id, sum(dr.score)::int AS score, count(*)::int AS dailies,
                      (array_agg(dr.home_state ORDER BY dr.daily_id DESC))[1] AS home_state
                 FROM daily_results dr JOIN daily_challenges dc ON dc.id = dr.daily_id
                WHERE dc.play_date >= $2::date AND dc.play_date < $3::date
                GROUP BY dr.user_id) w
        WHERE NOT EXISTS (SELECT 1 FROM weekly_standings WHERE iso_week = $1)
       ON CONFLICT DO NOTHING`,
      [lastWeek, lastWeekStart, addDays(lastWeekStart, 7)],
    );
    return saved + (weekly.rowCount ?? 0);
  }
}
