/**
 * Packs and Solo Practice (GDD §2.6, doc 09 §2.5, build plan step 2.8f). A player sees the packs
 * they can practise, unlocks a coins pack, and downloads a pack's practice set: up to 50
 * questions with their answers, the same all week, so Practice plays offline. A finished game is
 * sent afterwards and pays XP (never coins of its own, never rating), up to a daily cap.
 *
 * Because the set carries its answers, the questions in it count as seen by the player, so their
 * duels prefer others, and no question in today's or a planned Daily is ever in one.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PRACTICE_GAME_QUESTIONS,
  PRACTICE_RESULT_MAX_AGE_DAYS,
  PRACTICE_SET_SIZE,
  isoWeek,
  levelForXp,
  practiceXp,
  watDate,
} from '@whosabi/game-rules';
import {
  ErrorCode,
  PracticeResultRequest,
  type PackUnlockResponse,
  type PacksResponse,
  type PracticeQuestion,
  type PracticeResultResponse,
  type PracticeSet,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { withTransaction } from '../db';
import { balances, spendCoins, type CoinChange } from '../economy/ledger';
import { rewardPlayer } from '../economy/rewards';
import { ApiError, conflict, notFound, parse } from '../errors';
import { requestEventContext } from '../events';
import { configOf } from '../liveops/store';
import { watDayStart } from '../push/queue';
import { PACK_QUESTION, packSummary, upcomingDailyQuestions, visiblePacks } from './packs';

const DAY = 86_400_000;
/** How far ahead of the server's clock a device's "played at" may be. */
const CLOCK_SKEW_MS = 5 * 60_000;
const Params = z.object({ id: z.string().min(3).max(40) });
const perMinute = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

interface QuestionRow {
  id: string;
  category_id: string;
  type: 'mcq4' | 'true_false';
  text: string;
  options: string[];
  correct_index: number;
  fact: string | null;
  difficulty: number;
}

export function practiceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { pool, clock } = deps;

  const packFor = async (userId: string, id: string, now: number) => {
    const pack = (await visiblePacks(pool, userId, now, id))[0];
    if (!pack) throw notFound('This pack is not available.');
    return pack;
  };

  app.get('/v1/packs', async (request): Promise<PacksResponse> => {
    const { userId } = requireAuth(request);
    return { packs: (await visiblePacks(pool, userId, clock.now())).map(packSummary) };
  });

  /** Unlocks a coins pack for good. Unlocking one already unlocked costs nothing. */
  app.post('/v1/packs/:id/unlock', perMinute(20), async (request): Promise<PackUnlockResponse> => {
    const { userId } = requireAuth(request);
    const { id } = parse(Params, request.params);
    const now = clock.now();
    const pack = await packFor(userId, id, now);
    if (pack.access === 'pass') {
      throw conflict(
        ErrorCode.packLocked,
        'This pack comes with the Sabi Pass',
        'The Sabi Pass arrives soon.',
      );
    }
    let change: CoinChange | null = null;
    if (!pack.unlocked) {
      change = await withTransaction(pool, async (client) => {
        const price = pack.price_coins ?? 0;
        const spent = await spendCoins(client, userId, price, {
          key: `pack:${id}:${userId}`,
          reason: 'pack',
          refType: 'pack',
          refId: id,
          now,
        });
        await client.query(
          `INSERT INTO pack_unlocks (user_id, pack_id, coins, unlocked_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [userId, id, price, new Date(now)],
        );
        return spent;
      });
    }
    if (change) {
      const ctx = requestEventContext(request);
      await deps.events.emit('pack_unlocked', { pack_id: id, coins: -change.delta }, ctx);
      await deps.events.emit(
        'coins_changed',
        { delta: change.delta, reason: change.reason, balance_after: change.balance },
        ctx,
      );
    }
    return { pack: packSummary({ ...pack, unlocked: true }), coins: (await balances(pool, userId)).coins };
  });

  /**
   * The pack's practice set for this week, with the answers. The first fetch in a week picks it
   * (questions the player hasn't seen lately first) and marks it seen; later fetches that week
   * return the same questions, less any taken out of play since.
   */
  app.get('/v1/packs/:id/practice', perMinute(30), async (request): Promise<PracticeSet> => {
    const { userId } = requireAuth(request);
    const { id } = parse(Params, request.params);
    const now = clock.now();
    const pack = await packFor(userId, id, now);
    if (!pack.unlocked) {
      throw conflict(ErrorCode.packLocked, 'Unlock this pack first', 'Unlock it with coins to practise it.');
    }
    const today = watDate(now);
    const week = isoWeek(today);
    const family =
      (await pool.query<{ family_mode: boolean }>('SELECT family_mode FROM users WHERE id = $1', [userId]))
        .rows[0]?.family_mode ?? true;
    const params = [today, family, await upcomingDailyQuestions(pool, today)];
    const columns = 'q.id, q.category_id, q.type, q.text, q.options, q.correct_index, q.fact, q.difficulty';

    const issued = await withTransaction(pool, async (client) => {
      const existing = (
        await client.query<{ question_ids: string[]; issued_at: Date }>(
          'SELECT question_ids, issued_at FROM practice_sets WHERE user_id = $1 AND pack_id = $2 AND week = $3',
          [userId, id, week],
        )
      ).rows[0];
      if (existing) return existing;
      const picked = await client.query<{ id: string }>(
        `SELECT q.id FROM packs p, questions q
          WHERE p.id = $4 AND ${PACK_QUESTION}
          ORDER BY EXISTS (SELECT 1 FROM user_question_seen s
                            WHERE s.user_id = $5 AND s.question_id = q.id AND s.seen_at > $6),
                   random()
          LIMIT ${PRACTICE_SET_SIZE}`,
        [...params, id, userId, new Date(now - 30 * DAY)],
      );
      const ids = picked.rows.map((r) => r.id);
      const at = new Date(now);
      await client.query(
        `INSERT INTO practice_sets (user_id, pack_id, week, question_ids, issued_at) VALUES ($1, $2, $3, $4, $5)`,
        [userId, id, week, ids, at],
      );
      await client.query(
        `INSERT INTO user_question_seen (user_id, question_id, seen_at) SELECT $1, unnest($2::text[]), $3
         ON CONFLICT (user_id, question_id) DO UPDATE SET seen_at = EXCLUDED.seen_at`,
        [userId, ids, at],
      );
      return { question_ids: ids, issued_at: at };
    });

    // Still in play, in the set's order.
    const rows = (
      await pool.query<QuestionRow>(
        `SELECT ${columns} FROM packs p, questions q WHERE p.id = $4 AND q.id = ANY($5::text[]) AND ${PACK_QUESTION}`,
        [...params, id, issued.question_ids],
      )
    ).rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const config = await configOf(deps);
    return {
      pack_id: id,
      week,
      issued_at: issued.issued_at.toISOString(),
      time_limit_ms: config['duel.timer_text_s'] * 1000,
      questions: issued.question_ids.flatMap((qid): PracticeQuestion[] => {
        const q = byId.get(qid);
        return q
          ? [
              {
                qid: q.id,
                category_id: q.category_id,
                type: q.type,
                text: q.text,
                options: q.options,
                correct_index: q.correct_index,
                fact: q.fact,
                difficulty: q.difficulty,
              },
            ]
          : [];
      }),
    };
  });

  /**
   * A finished practice game. Its questions must come from the player's set for that pack and
   * week; the answers are checked here against the questions as they are now. Sending the same
   * game again returns what it paid the first time.
   */
  app.post('/v1/practice/results', perMinute(60), async (request): Promise<PracticeResultResponse> => {
    const { userId } = requireAuth(request);
    const body = parse(PracticeResultRequest, request.body);
    const now = clock.now();
    const playedAt = Date.parse(body.played_at);
    if (playedAt > now + CLOCK_SKEW_MS || playedAt < now - PRACTICE_RESULT_MAX_AGE_DAYS * DAY) {
      throw new ApiError(400, ErrorCode.validation, 'The request is not valid', 'played_at: out of range');
    }
    const set = (
      await pool.query<{ question_ids: string[] }>(
        'SELECT question_ids FROM practice_sets WHERE user_id = $1 AND pack_id = $2 AND week = $3',
        [userId, body.pack_id, body.week],
      )
    ).rows[0];
    if (!set) throw notFound('No practice set for this pack and week.');
    const inSet = new Set(set.question_ids);
    if (body.answers.some((a) => !inSet.has(a.qid))) {
      throw new ApiError(400, ErrorCode.validation, 'The request is not valid', 'answers: not in the set');
    }
    const keys = new Map(
      (
        await pool.query<{ id: string; correct_index: number }>(
          'SELECT id, correct_index FROM questions WHERE id = ANY($1::text[])',
          [body.answers.map((a) => a.qid)],
        )
      ).rows.map((r) => [r.id, r.correct_index]),
    );
    const answered = body.answers.length;
    const correct = body.answers.filter((a) => a.picked !== null && keys.get(a.qid) === a.picked).length;
    // The finish counts when every question of a full game was answered.
    const complete = body.complete && answered >= Math.min(PRACTICE_GAME_QUESTIONS, set.question_ids.length);
    const earned = practiceXp(correct, answered, complete);
    const config = await configOf(deps);

    const outcome = await withTransaction(pool, async (client) => {
      const user = (
        await client.query<{ xp: string }>('SELECT xp FROM users WHERE id = $1 FOR UPDATE', [userId])
      ).rows[0];
      if (!user) throw notFound();
      const before = (
        await client.query<{ xp: number; answered: number; correct: number }>(
          'SELECT xp, answered, correct FROM practice_results WHERE user_id = $1 AND id = $2',
          [userId, body.id],
        )
      ).rows[0];
      if (before) {
        return {
          repeat: true,
          xp: before.xp,
          answered: before.answered,
          correct: before.correct,
          level: levelForXp(Number(user.xp)).level,
          changes: [] as CoinChange[],
        };
      }
      const today = (
        await client.query<{ xp: number }>(
          'SELECT coalesce(sum(xp), 0)::int AS xp FROM practice_results WHERE user_id = $1 AND received_at >= $2',
          [userId, new Date(watDayStart(now))],
        )
      ).rows[0]!.xp;
      const xp = Math.max(0, Math.min(earned, config['practice.xp_daily_cap'] - today));
      await client.query(
        `INSERT INTO practice_results (user_id, id, pack_id, week, answered, correct, complete, xp, played_at, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          userId,
          body.id,
          body.pack_id,
          body.week,
          answered,
          correct,
          complete,
          xp,
          new Date(playedAt),
          new Date(now),
        ],
      );
      // Practice pays no coins of its own; a level it reaches pays the usual level-up coins.
      const paid =
        xp > 0
          ? await rewardPlayer(client, userId, {
              xp,
              coins: 0,
              config,
              reason: 'level_up',
              key: `practice:${body.id}:${userId}`,
              refType: 'practice',
              refId: body.id,
              now,
            })
          : null;
      return {
        repeat: false,
        xp,
        answered,
        correct,
        level: paid?.level ?? levelForXp(Number(user.xp)).level,
        changes: paid?.changes ?? [],
      };
    });

    if (!outcome.repeat) {
      const ctx = requestEventContext(request);
      await deps.events.emit(
        'practice_completed',
        {
          pack_id: body.pack_id,
          answered,
          correct_count: correct,
          complete,
          xp: outcome.xp,
          delay_s: Math.max(0, Math.round((now - playedAt) / 1000)),
        },
        ctx,
      );
      for (const change of outcome.changes) {
        await deps.events.emit(
          'coins_changed',
          { delta: change.delta, reason: change.reason, balance_after: change.balance },
          ctx,
        );
      }
    }
    return {
      correct: outcome.correct,
      answered: outcome.answered,
      xp: outcome.xp,
      capped: !outcome.repeat && outcome.xp < earned,
      level: outcome.level,
    };
  });
}
