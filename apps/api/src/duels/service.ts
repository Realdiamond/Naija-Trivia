/**
 * The async duel (GDD §2.1, TRD §4.3 and §5.2–5.4). Every change runs in one transaction
 * that locks the duel's row, so the two players' requests never interleave, and turns move
 * only through the `game-rules` state machine. Analytics events and question stats are sent
 * after the commit, so nothing is ever reported for work that was rolled back.
 *
 * Expiry runs in two places: `expireDue` for the workers (build plan step 1.3), and lazily
 * whenever someone touches a duel that is past its deadline.
 *
 * Random opponents (step 2.3, TRD FR-DUEL-6): a random duel waits in the pool for a stranger
 * near the challenger's rating; after a minute the workers seat the Sabi Bot, and play its turns.
 */
import { randomBytes, randomInt } from 'node:crypto';
import {
  acceptElapsed,
  applyDuelEvent,
  BOT_TURN_DELAY_MS,
  botAnswer,
  botGuess,
  canMatch,
  categoryPicker,
  DEFAULT_CONFIG,
  displayOrder,
  DUEL_ROUNDS,
  EXTRA_TIME_MS,
  fiftyFifty,
  lifelineCost,
  duelCoins,
  DuelTransitionError,
  boostedDuelXp,
  isFinished,
  MATCH_WAIT_MS,
  NEW_PLAYER_RATING,
  OFFLINE_RESEND_GRACE_MS,
  optionPermutation,
  QUESTIONS_PER_ROUND,
  resolveTiebreak,
  roundsForTurn,
  scoreAnswer,
  shuffleSeed,
  TIEBREAK_ROUND,
  toCanonicalIndex,
  toDisplayIndex,
  turnSide,
  type DuelOutcome,
  type DuelSide,
  type DuelSnapshot,
} from '@whosabi/game-rules';
import {
  ErrorCode,
  type AnswerRequest,
  type CreateDuelRequest,
  type DuelAnswerResponse,
  type DuelSource,
  type DuelView,
  type InvitePreview,
  type Lifeline,
  type LifelineRequest,
  type LifelineResponse,
  type ListDuelsQuery,
  type ListDuelsResponse,
  type ServedQuestion,
  type TiebreakAnswerRequest,
  type TiebreakAnswerResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { configOf } from '../liveops/store';
import { overallRating, recordQuestionStats } from '../content/stats';
import { withTransaction, type Pool, type PoolClient } from '../db';
import { balances, spendCoins } from '../economy/ledger';
import { rewardPlayer } from '../economy/rewards';
import { ApiError, conflict, notFound } from '../errors';
import type { EventContext } from '../events';
import { newId } from '../ids';
import {
  combinedRating,
  loadQuestions,
  markSeen,
  pickRoundQuestions,
  pickSkipQuestion,
  pickTiebreakQuestion,
  type DuelQuestion,
} from './questions';
import { duelKey, queuePush } from '../push/queue';
import { rttFor } from '../rtt';
import { canChallenge, isBlocked } from '../social/graph';
import { askNaijaFor, lifelinesOf, questionLifelines, type LifelineRow } from './lifelines';
import { applyDuelRatings } from './ratings';
import {
  ACTIVE_STATES,
  activeDuelCount,
  FINISHED_STATES,
  getAnswers,
  getDuel,
  getPlayers,
  getRounds,
  humansOf,
  isDue,
  lockDuel,
  lockPlayers,
  playedRows,
  playerFor,
  roundFinished,
  SABI_BOT_ID,
  sideOf,
  snapshotOf,
  type AnswerRow,
  type DuelRow,
  type RoundRow,
} from './repo';
import { buildSummary, buildView, nextAction, resultFor, visibleQuestionIds, type DuelData } from './view';

/** PRD US-3 AC4: up to 20 duels going at once (the Sabi Pass lifts this in v1.1). */
export const MAX_ACTIVE_DUELS = 20;
/** A result push still means something for a day. */
const RESULT_PUSH_MS = 24 * 3_600_000;
const TURN_MS = DEFAULT_CONFIG['duel.turn_expiry_h'] * 3_600_000;
const TIME_LIMIT_MS = DEFAULT_CONFIG['duel.timer_text_s'] * 1000;
/** Who acts for the Sabi Bot. Its events are never sent: they would count it as a player. */
const BOT_ACTOR: EventContext = { userId: SABI_BOT_ID, platform: 'web' };

type Outbox = Array<() => Promise<void>>;

/** A transaction holding the duel's row lock. `duel` is kept current as the duel moves on. */
interface Tx {
  client: PoolClient;
  duel: DuelRow;
  now: number;
  outbox: Outbox;
}

interface PlayerTx extends Tx {
  viewer: string;
  side: DuelSide;
}

const notAllowed = (detail: string) =>
  conflict(ErrorCode.lifelineNotAllowed, "You can't use that lifeline now", detail);
const duelFinished = (detail?: string) => conflict(ErrorCode.duelFinished, 'This duel is over', detail);
const turnNotYours = (detail?: string) => conflict(ErrorCode.turnNotYours, 'It is not your turn', detail);

/** What the duel engine needs: the API passes its own deps, and the worker builds these itself. */
export type DuelDeps = Pick<AppDeps, 'config' | 'pool' | 'redis' | 'clock' | 'events' | 'log'> &
  Partial<Pick<AppDeps, 'liveops'>>;

export class DuelService {
  /** `random` decides the Sabi Bot's answers; tests pass a repeatable one. */
  constructor(
    private readonly deps: DuelDeps,
    private readonly random: () => number = Math.random,
  ) {}

  // ----- Reading -----

  async get(duelId: string, viewer: string): Promise<DuelView> {
    const duel = await getDuel(this.deps.pool, duelId);
    if (!duel || sideOf(duel, viewer) === null) throw notFound('This duel does not exist.');
    if (isDue(duel, this.deps.clock.now())) await this.expireOne(duelId);
    return this.view(duelId, viewer);
  }

  async list(viewer: string, query: ListDuelsQuery): Promise<ListDuelsResponse> {
    const { pool, clock } = this.deps;
    if (query.state === 'active') {
      const due = await pool.query<{ id: string }>(
        `SELECT id FROM duels WHERE (player_a = $1 OR player_b = $1)
            AND state = ANY($2::duel_state[]) AND turn_deadline <= $3`,
        [viewer, ACTIVE_STATES, new Date(clock.now())],
      );
      for (const { id } of due.rows) await this.expireOne(id);
      const ids = await pool.query<{ id: string }>(
        `SELECT id FROM duels WHERE (player_a = $1 OR player_b = $1) AND state = ANY($2::duel_state[])
          ORDER BY turn_deadline, id LIMIT $3`,
        [viewer, ACTIVE_STATES, query.limit],
      );
      const summaries = (
        await this.load(
          pool,
          ids.rows.map((r) => r.id),
        )
      ).map((d) => buildSummary(d, viewer));
      // "Your turn" first, soonest deadline first (UX §3.4).
      summaries.sort(
        (x, y) =>
          Number(y.your_turn) - Number(x.your_turn) ||
          (x.turn_deadline ?? '').localeCompare(y.turn_deadline ?? ''),
      );
      return { duels: summaries, next_cursor: null };
    }

    const cursor = decodeCursor(query.cursor);
    const page = await pool.query<{ id: string; completed_at: Date }>(
      `SELECT id, completed_at FROM duels
        WHERE (player_a = $1 OR player_b = $1) AND state = ANY($2::duel_state[])
          AND ($3::timestamptz IS NULL OR (completed_at, id) < ($3, $4))
        ORDER BY completed_at DESC, id DESC LIMIT $5`,
      [viewer, FINISHED_STATES, cursor ? new Date(cursor.at) : null, cursor?.id ?? '', query.limit + 1],
    );
    const rows = page.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      duels: (
        await this.load(
          pool,
          rows.map((r) => r.id),
        )
      ).map((d) => buildSummary(d, viewer)),
      next_cursor:
        page.rows.length > query.limit && last ? encodeCursor(last.completed_at.getTime(), last.id) : null,
    };
  }

  async invitePreview(token: string): Promise<InvitePreview> {
    const { pool, clock } = this.deps;
    const duel = (await pool.query<DuelRow>('SELECT * FROM duels WHERE invite_token = $1', [token])).rows[0];
    if (!duel) throw notFound('This challenge link does not exist.');
    const challenger = (await getPlayers(pool, [duel.player_a])).get(duel.player_a);
    const closed = isFinished(duel.state) || isDue(duel, clock.now());
    const status = closed ? 'closed' : duel.player_b ? 'taken' : 'open';
    return {
      challenger: {
        id: duel.player_a,
        username: challenger?.username ?? null,
        level: challenger?.level ?? 1,
      },
      status,
      expires_at: status === 'open' && duel.turn_deadline ? duel.turn_deadline.toISOString() : null,
    };
  }

  // ----- Starting a duel -----

  async create(viewer: string, body: CreateDuelRequest, ctx: EventContext): Promise<DuelView> {
    if ('random' in body.opponent) return this.createRandom(viewer, ctx);
    const opponentId = 'user_id' in body.opponent ? body.opponent.user_id : null;
    if (opponentId === viewer) {
      throw new ApiError(
        400,
        ErrorCode.validation,
        'The request is not valid',
        "You can't challenge yourself.",
      );
    }
    const source: DuelSource = opponentId ? 'friend' : 'link';
    const now = this.deps.clock.now();
    const outbox: Outbox = [];
    const duelId = await withTransaction(this.deps.pool, async (client) => {
      await lockPlayers(client, opponentId ? [viewer, opponentId] : [viewer]);
      await this.assertCanStart(client, viewer, opponentId);
      const id = await this.insertDuel(client, { playerA: viewer, playerB: opponentId, source, now });
      outbox.push(() => this.deps.events.emit('duel_created', { opponent_type: source }, ctx));
      return id;
    });
    await flush(outbox);
    return this.view(duelId, viewer);
  }

  async acceptInvite(token: string, viewer: string): Promise<DuelView> {
    const now = this.deps.clock.now();
    const outbox: Outbox = [];
    const outcome = await withTransaction(this.deps.pool, async (client) => {
      const duel = (
        await client.query<DuelRow>('SELECT * FROM duels WHERE invite_token = $1 FOR UPDATE', [token])
      ).rows[0];
      if (!duel) return { kind: 'missing' } as const;
      if (duel.player_b === viewer) return { kind: 'done', id: duel.id } as const;
      if (duel.player_a === viewer) {
        throw conflict(ErrorCode.conflict, 'This is your own challenge', 'Share the link with a friend.');
      }
      if (duel.player_b !== null)
        throw conflict(ErrorCode.inviteTaken, 'Someone already took this challenge');
      if (isDue(duel, now)) {
        await this.expire({ client, duel, now, outbox });
        return { kind: 'expired' } as const;
      }
      if (isFinished(duel.state)) throw duelFinished();
      if (await isBlocked(client, duel.player_a, viewer)) {
        throw conflict(ErrorCode.opponentUnavailable, "You can't take this challenge");
      }
      await lockPlayers(client, [viewer]);
      await this.assertCanStart(client, viewer, null);
      await this.seat(client, duel, viewer, now);
      return { kind: 'done', id: duel.id } as const;
    });
    await flush(outbox);
    if (outcome.kind === 'missing') throw notFound('This challenge link does not exist.');
    if (outcome.kind === 'expired') throw duelFinished('The challenge ran out of time.');
    return this.view(outcome.id, viewer);
  }

  /**
   * A random opponent (FR-DUEL-6): take the seat in a waiting random duel whose challenger is
   * close enough in rating for how long they have waited, or start one that waits for the next
   * player. Duels you can play at once (the challenger has played round 1) go first, then the
   * longest waiting. Nobody is paired with someone they blocked, or already playing them.
   */
  private async createRandom(viewer: string, ctx: EventContext): Promise<DuelView> {
    const now = this.deps.clock.now();
    const outbox: Outbox = [];
    const duelId = await withTransaction(this.deps.pool, async (client) => {
      await lockPlayers(client, [viewer]);
      await this.assertCanStart(client, viewer, null);
      const rating = await combinedRating(client, [viewer]);
      const pool = await client.query<{
        id: string;
        player_a: string;
        rating: number;
        created_at: Date;
        ready: boolean;
      }>(
        `SELECT d.id, d.player_a, coalesce(r.rating, $3) AS rating, d.created_at, d.state = 'wait_b_r1r2' AS ready
           FROM duels d LEFT JOIN ratings r ON r.user_id = d.player_a AND r.scope = 'overall'
          WHERE d.source = 'random' AND d.player_b IS NULL AND d.created_at > $2
            AND d.state IN ('created', 'wait_b_r1r2') AND d.player_a <> $1
          ORDER BY d.created_at LIMIT 100`,
        [viewer, new Date(now - MATCH_WAIT_MS), NEW_PLAYER_RATING.rating],
      );
      const candidates = pool.rows
        .filter((c) => canMatch(rating, c.rating, now - c.created_at.getTime()))
        .sort((x, y) => Number(y.ready) - Number(x.ready));
      for (const c of candidates) {
        if (await isBlocked(client, c.player_a, viewer)) continue;
        if (await playingAlready(client, c.player_a, viewer)) continue;
        // Someone else may be taking it right now: then try the next.
        const duel = (
          await client.query<DuelRow>(
            'SELECT * FROM duels WHERE id = $1 AND player_b IS NULL FOR UPDATE SKIP LOCKED',
            [c.id],
          )
        ).rows[0];
        if (!duel || (duel.state !== 'created' && duel.state !== 'wait_b_r1r2')) continue;
        await this.seat(client, duel, viewer, now);
        return duel.id;
      }
      const id = await this.insertDuel(client, { playerA: viewer, playerB: null, source: 'random', now });
      outbox.push(() => this.deps.events.emit('duel_created', { opponent_type: 'random' }, ctx));
      return id;
    });
    await flush(outbox);
    return this.view(duelId, viewer);
  }

  /** A rematch of a finished duel. Both players asking at once still get one new duel. */
  async rematch(
    duelId: string,
    viewer: string,
    ctx: EventContext,
  ): Promise<{ duel: DuelView; created: boolean }> {
    let created = false;
    const id = await this.withDuel(duelId, viewer, async ({ client, duel, side, now, outbox }) => {
      if (duel.state !== 'complete' && duel.state !== 'forfeit') {
        throw conflict(ErrorCode.conflict, 'Finish this duel first');
      }
      const existing = await client.query<{ id: string }>('SELECT id FROM duels WHERE rematch_of = $1', [
        duel.id,
      ]);
      if (existing.rows[0]) return existing.rows[0].id;
      const opponentId = playerFor(duel, side === 'a' ? 'b' : 'a')!;
      if (opponentId === SABI_BOT_ID) {
        throw conflict(
          ErrorCode.conflict,
          'The Sabi Bot does not play rematches',
          'Find a random opponent instead.',
        );
      }
      await lockPlayers(client, [viewer, opponentId]);
      await this.assertCanStart(client, viewer, opponentId);
      const newDuel = await this.insertDuel(client, {
        playerA: viewer,
        playerB: opponentId,
        source: 'rematch',
        rematchOf: duel.id,
        now,
      });
      outbox.push(() => this.deps.events.emit('duel_created', { opponent_type: 'rematch' }, ctx));
      created = true;
      return newDuel;
    });
    return { duel: await this.view(id, viewer), created };
  }

  // ----- Playing -----

  async pickCategory(duelId: string, roundNo: number, categoryId: string, viewer: string): Promise<DuelView> {
    await this.withDuel(duelId, viewer, async ({ client, duel, side, now }) => {
      if (isFinished(duel.state)) throw duelFinished();
      const turnRounds: number[] = roundsForTurn(duel.state);
      if (turnSide(duel.state) !== side || !turnRounds.includes(roundNo)) throw turnNotYours();
      if (categoryPicker(roundNo as 1 | 2 | 3) !== side) {
        throw turnNotYours('Your opponent picks the category for this round.');
      }
      const rounds = await getRounds(client, [duel.id]);
      assertEarlierRoundsDone(turnRounds, roundNo, rounds, await getAnswers(client, [duel.id]), viewer);
      const round = rounds.find((r) => r.round_no === roundNo)!;
      if (round.category_id !== null) {
        if (round.category_id === categoryId) return; // the same pick again
        throw conflict(ErrorCode.conflict, 'The category for this round is already picked');
      }
      if (!round.offered.includes(categoryId)) {
        throw conflict(
          ErrorCode.categoryNotOffered,
          'Pick one of the offered categories',
          `Offered: ${round.offered.join(', ')}.`,
        );
      }
      if (!(await this.fillRound({ client, duel, now }, rounds, roundNo, categoryId, viewer))) {
        throw new ApiError(
          503,
          ErrorCode.noQuestions,
          'No questions are available right now',
          'Pick another category or try again soon.',
        );
      }
    });
    return this.view(duelId, viewer);
  }

  /** Reveal one question and start its timer. Serving it again returns the same question and time. */
  async serve(
    duelId: string,
    roundNo: number,
    seq: number,
    viewer: string,
    ctx: EventContext,
  ): Promise<ServedQuestion> {
    return this.withDuel(duelId, viewer, async ({ client, duel, side, now, outbox }) => {
      if (isFinished(duel.state)) throw duelFinished();
      const rounds = await getRounds(client, [duel.id]);
      const answers = await getAnswers(client, [duel.id]);
      const round = rounds.find((r) => r.round_no === roundNo);

      if (roundNo === TIEBREAK_ROUND) {
        if (duel.state !== 'tiebreak' || !round) throw turnNotYours('There is no tie-break in this duel.');
        if (seq !== 1) throw notFound('The tie-break has one question.');
      } else {
        const turnRounds: number[] = roundsForTurn(duel.state);
        if (turnSide(duel.state) !== side || !turnRounds.includes(roundNo)) throw turnNotYours();
        assertEarlierRoundsDone(turnRounds, roundNo, rounds, answers, viewer);
        if (!round || round.category_id === null) {
          throw conflict(ErrorCode.categoryNotPicked, 'Pick a category first');
        }
        if (seq > round.question_ids.length) {
          throw notFound(`Round ${roundNo} has ${round.question_ids.length} questions.`);
        }
        for (let earlier = 1; earlier < seq; earlier++) {
          if (!findAnswer(answers, roundNo, earlier, viewer)?.received_at) {
            throw conflict(ErrorCode.outOfOrder, 'Answer the previous question first');
          }
        }
      }

      const existing = findAnswer(answers, roundNo, seq, viewer);
      // After Skip, the player's question at this place is the one swapped in.
      const qid = existing?.question_id ?? round.question_ids[seq - 1]!;
      const q = (await loadQuestions(client, [qid])).get(qid);
      if (!q) throw notFound('This question is no longer available.');
      const inserted = await client.query<{ served_at: Date }>(
        `INSERT INTO duel_answers (duel_id, round_no, seq, user_id, question_id, served_at, platform)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING served_at`,
        [duel.id, roundNo, seq, viewer, qid, new Date(now), ctx.platform],
      );
      let servedAt = inserted.rows[0]?.served_at;
      if (servedAt) {
        await markSeen(client, viewer, qid, now);
        outbox.push(() => this.deps.events.emit('question_served', { qid, mode: 'duel', seq }, ctx));
      } else {
        servedAt = existing!.served_at;
      }
      return this.served(client, duel, viewer, round, seq, q, servedAt, existing?.extra_ms ?? 0);
    });
  }

  /**
   * A lifeline on the question being played (GDD §5.2): one of each per duel, paid for with coins
   * before it takes effect, all in one transaction. Asking again for the same question gives the
   * same answer without paying twice.
   */
  async useLifeline(
    duelId: string,
    body: LifelineRequest,
    viewer: string,
    ctx: EventContext,
  ): Promise<LifelineResponse> {
    return this.withDuel(duelId, viewer, async ({ client, duel, side, now, outbox }) => {
      const { type, round: roundNo, seq } = body;
      if (isFinished(duel.state)) throw duelFinished();
      const turnRounds: number[] = roundsForTurn(duel.state);
      if (turnSide(duel.state) !== side || !turnRounds.includes(roundNo)) throw turnNotYours();
      const rounds = await getRounds(client, [duel.id]);
      const round = rounds.find((r) => r.round_no === roundNo)!;
      const row = findAnswer(await getAnswers(client, [duel.id]), roundNo, seq, viewer);
      if (!row) throw conflict(ErrorCode.questionNotServed, 'This question has not been shown yet');
      const used = await lifelinesOf(client, duel.id, viewer);
      const before = used.find((l) => l.type === type);
      const q = (await loadQuestions(client, [row.question_id])).get(row.question_id)!;
      const respond = async (question: typeof q, servedAt: Date, extraMs: number) => ({
        question: await this.served(client, duel, viewer, round, seq, question, servedAt, extraMs),
        coins: (await balances(client, viewer)).coins,
      });

      if (before) {
        // The same request again (a retry or double tap): what it showed, at no charge.
        const sameQuestion =
          type === 'skip' ? before.effect.to === row.question_id : before.question_id === q.id;
        if (before.round_no === roundNo && before.seq === seq && sameQuestion && !row.received_at) {
          return respond(q, row.served_at, row.extra_ms);
        }
        throw conflict(ErrorCode.lifelineUsed, 'Lifeline already used', 'Each lifeline works once a duel.');
      }
      if (row.received_at) throw notAllowed('This question is already answered.');
      if (now - row.served_at.getTime() >= TIME_LIMIT_MS + row.extra_ms) {
        throw notAllowed('Time is up for this question.');
      }
      if (type === 'fifty' && q.options.length !== 4) throw notAllowed('50/50 needs four options.');

      // The price the player's app showed: lifeline prices can differ by platform (step 2.7t).
      const cost = lifelineCost(type, await configOf(this.deps, ctx.platform));
      const paid = await spendCoins(client, viewer, cost, {
        key: `lifeline:${duel.id}:${viewer}:${type}`,
        reason: 'lifeline',
        refType: 'duel',
        refId: duel.id,
        now,
      });

      let shown = q;
      let servedAt = row.served_at;
      let extraMs = row.extra_ms;
      let effect: LifelineRow['effect'] = {};
      if (type === 'fifty') {
        effect = { removed: fiftyFifty(4, q.correct_index!, `${duel.id}:${viewer}:${q.id}`) };
      } else if (type === 'ask_naija') {
        effect = { percents: await askNaijaFor(client, q) };
      } else if (type === 'time') {
        extraMs += EXTRA_TIME_MS;
      } else {
        const players = humansOf(duel);
        const answers = await getAnswers(client, [duel.id]);
        const next = await pickSkipQuestion(client, q, {
          players,
          familySafeOnly: await familySafeOnly(client, players),
          exclude: [...rounds.flatMap((r) => r.question_ids), ...answers.map((a) => a.question_id)],
          now,
        });
        if (!next) throw notAllowed('There is no other question to swap in.');
        shown = (await loadQuestions(client, [next])).get(next)!;
        // A new question gets its own clock; Extra Time was for the old one.
        servedAt = new Date(now);
        extraMs = 0;
        effect = { to: next };
        await markSeen(client, viewer, next, now);
        outbox.push(() => this.deps.events.emit('question_served', { qid: next, mode: 'duel', seq }, ctx));
      }
      await client.query(
        `INSERT INTO duel_lifelines (duel_id, user_id, type, round_no, seq, question_id, effect, paid_with, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'coins', $8)`,
        [duel.id, viewer, type, roundNo, seq, q.id, JSON.stringify(effect), new Date(now)],
      );
      await client.query(
        `UPDATE duel_answers SET question_id = $5, served_at = $6, extra_ms = $7, lifeline = $8
          WHERE duel_id = $1 AND round_no = $2 AND seq = $3 AND user_id = $4`,
        [duel.id, roundNo, seq, viewer, shown.id, servedAt, extraMs, type],
      );
      outbox.push(() =>
        this.deps.events.emit('lifeline_used', { type, paid_with: 'coins', mode: 'duel' }, ctx),
      );
      if (paid) {
        outbox.push(() =>
          this.deps.events.emit(
            'coins_changed',
            { delta: paid.delta, reason: paid.reason, balance_after: paid.balance },
            ctx,
          ),
        );
      }
      return respond(shown, servedAt, extraMs);
    });
  }

  /** A question as one player sees it: their option order, their clock and, in rounds 1–3, their lifelines. */
  private async served(
    client: PoolClient,
    duel: DuelRow,
    viewer: string,
    round: RoundRow,
    seq: number,
    q: DuelQuestion,
    servedAt: Date,
    extraMs: number,
  ): Promise<ServedQuestion> {
    const numeric = q.type === 'closest_number';
    const perm = numeric ? [] : permFor(duel.id, viewer, q);
    return {
      qid: q.id,
      seq,
      total: round.question_ids.length,
      type: q.type,
      category_id: q.category_id,
      text: q.text,
      options: numeric ? [] : displayOrder(q.options, perm),
      media: null,
      time_limit_ms: TIME_LIMIT_MS + extraMs,
      served_at: servedAt.toISOString(),
      ...(round.round_no === TIEBREAK_ROUND
        ? {}
        : {
            lifelines: questionLifelines(
              await lifelinesOf(client, duel.id, viewer),
              round.round_no,
              seq,
              q,
              perm,
            ),
          }),
    };
  }

  async answer(
    duelId: string,
    roundNo: number,
    seq: number,
    body: AnswerRequest,
    idempotencyKey: string | undefined,
    viewer: string,
    ctx: EventContext,
  ): Promise<DuelAnswerResponse> {
    return this.withDuel(duelId, viewer, async (tx) => {
      const { client, duel, side, now, outbox } = tx;
      const row = findAnswer(await getAnswers(client, [duel.id]), roundNo, seq, viewer);
      // A retry or double tap gets the first result back, even after the duel moved on.
      if (row?.received_at) {
        assertSameRequest(row, idempotencyKey);
        return this.answerResponse(tx, row);
      }
      if (isFinished(duel.state)) throw duelFinished();
      const turnRounds: number[] = roundsForTurn(duel.state);
      if (turnSide(duel.state) !== side || !turnRounds.includes(roundNo)) throw turnNotYours();
      if (!row) throw conflict(ErrorCode.questionNotServed, 'This question has not been shown yet');

      const q = (await loadQuestions(client, [row.question_id])).get(row.question_id)!;
      // The session's measured round trip (TRD §5.3), or the default before any ping.
      const rtt = await rttFor(this.deps.redis, viewer, ctx.sessionId, this.deps.config.defaultRttMs);
      const timing = acceptElapsed({
        clientElapsedMs: body.client_elapsed_ms,
        serverElapsedMs: Math.max(0, now - row.served_at.getTime()),
        rttEstMs: rtt,
        // Extra Time's 10 s more to answer; speed points still count against the usual limit.
        timeLimitMs: TIME_LIMIT_MS + row.extra_ms,
        offlineGraceMs: OFFLINE_RESEND_GRACE_MS,
      });
      const perm = permFor(duel.id, viewer, q);
      if (body.display_index !== null && body.display_index >= perm.length) {
        throw new ApiError(
          400,
          ErrorCode.validation,
          'The request is not valid',
          'display_index: out of range',
        );
      }
      const chosen =
        body.display_index === null || timing.timedOut ? null : toCanonicalIndex(perm, body.display_index);
      const correct = chosen !== null && chosen === q.correct_index;
      const before = playedRows(await getAnswers(client, [duel.id]), viewer);
      const score = scoreAnswer({
        correct,
        elapsedMs: timing.acceptedMs,
        timeLimitMs: TIME_LIMIT_MS,
        streakBefore: trailingStreak(before),
      });

      await client.query(
        `UPDATE duel_answers SET received_at = $5, client_elapsed_ms = $6, accepted_elapsed_ms = $7,
                rtt_est_ms = $8, display_index = $9, chosen_index = $10, correct = $11, points = $12,
                tab_hidden_ms = $13, idempotency_key = $14
          WHERE duel_id = $1 AND round_no = $2 AND seq = $3 AND user_id = $4`,
        [
          duel.id,
          roundNo,
          seq,
          viewer,
          new Date(now),
          body.client_elapsed_ms,
          timing.acceptedMs,
          rtt,
          body.display_index,
          chosen,
          correct,
          score.points,
          body.tab_hidden_ms ?? null,
          idempotencyKey ?? null,
        ],
      );
      outbox.push(async () =>
        recordQuestionStats(
          this.deps.redis,
          this.deps.log,
          q.id,
          { correct, acceptedMs: timing.acceptedMs, canonicalIndex: chosen },
          { itemRating: q.d_rating, playerRating: await overallRating(this.deps.pool, viewer) },
        ),
      );
      outbox.push(() =>
        this.deps.events.emit(
          'question_answered',
          {
            qid: q.id,
            category: q.category_id,
            difficulty: q.difficulty,
            correct,
            timed_out: timing.timedOut,
            accepted_elapsed_ms: timing.acceptedMs,
            points: score.points,
            mode: 'duel',
            lifeline: (row.lifeline as Lifeline | null) ?? null,
            ...(body.tab_hidden_ms !== undefined ? { tab_hidden_ms: body.tab_hidden_ms } : {}),
          },
          ctx,
        ),
      );

      await this.afterAnswer(tx, roundNo, ctx);
      const saved = findAnswer(await getAnswers(client, [duel.id]), roundNo, seq, viewer)!;
      return this.answerResponse(tx, saved);
    });
  }

  async tiebreakAnswer(
    duelId: string,
    body: TiebreakAnswerRequest,
    idempotencyKey: string | undefined,
    viewer: string,
    ctx: EventContext,
  ): Promise<TiebreakAnswerResponse> {
    return this.withDuel(duelId, viewer, async (tx) => {
      const { client, duel, now, outbox } = tx;
      const row = findAnswer(await getAnswers(client, [duel.id]), TIEBREAK_ROUND, 1, viewer);
      if (row?.received_at) {
        assertSameRequest(row, idempotencyKey);
        return this.tiebreakResponse(tx, row);
      }
      if (isFinished(duel.state)) throw duelFinished();
      if (duel.state !== 'tiebreak') throw turnNotYours('There is no tie-break in this duel.');
      if (!row) throw conflict(ErrorCode.questionNotServed, 'This question has not been shown yet');

      const q = (await loadQuestions(client, [row.question_id])).get(row.question_id)!;
      // The session's measured round trip (TRD §5.3), or the default before any ping.
      const rtt = await rttFor(this.deps.redis, viewer, ctx.sessionId, this.deps.config.defaultRttMs);
      const timing = acceptElapsed({
        clientElapsedMs: body.client_elapsed_ms,
        serverElapsedMs: Math.max(0, now - row.served_at.getTime()),
        rttEstMs: rtt,
        timeLimitMs: TIME_LIMIT_MS,
        offlineGraceMs: OFFLINE_RESEND_GRACE_MS,
      });
      const guess = timing.timedOut ? null : body.guess;
      const correct = guess !== null && guess === q.numeric_answer;
      await client.query(
        `UPDATE duel_answers SET received_at = $3, client_elapsed_ms = $4, accepted_elapsed_ms = $5,
                rtt_est_ms = $6, guess = $7, correct = $8, points = 0, idempotency_key = $9
          WHERE duel_id = $1 AND round_no = ${TIEBREAK_ROUND} AND seq = 1 AND user_id = $2`,
        [
          duel.id,
          viewer,
          new Date(now),
          body.client_elapsed_ms,
          timing.acceptedMs,
          rtt,
          guess,
          correct,
          idempotencyKey ?? null,
        ],
      );
      outbox.push(() =>
        recordQuestionStats(this.deps.redis, this.deps.log, q.id, {
          correct,
          acceptedMs: timing.acceptedMs,
          canonicalIndex: null,
        }),
      );
      outbox.push(() =>
        this.deps.events.emit(
          'question_answered',
          {
            qid: q.id,
            category: q.category_id,
            difficulty: q.difficulty,
            correct,
            timed_out: timing.timedOut,
            accepted_elapsed_ms: timing.acceptedMs,
            points: 0,
            mode: 'duel',
            lifeline: null,
          },
          ctx,
        ),
      );

      const answered = await this.resolveTiebreak(tx, q, ctx);
      return this.tiebreakResponse(tx, findAnswer(answered, TIEBREAK_ROUND, 1, viewer)!);
    });
  }

  async decline(duelId: string, viewer: string): Promise<DuelView> {
    return this.endEarly(duelId, viewer, 'declined');
  }

  async cancel(duelId: string, viewer: string): Promise<DuelView> {
    return this.endEarly(duelId, viewer, 'cancelled');
  }

  // ----- Expiry -----

  /** Expire every duel past its deadline (for the workers, build plan step 1.3). Returns how many. */
  async expireDue(limit = 100): Promise<number> {
    const now = this.deps.clock.now();
    const outbox: Outbox = [];
    const expired = await withTransaction(this.deps.pool, async (client) => {
      const due = await client.query<DuelRow>(
        `SELECT * FROM duels WHERE state = ANY($1::duel_state[]) AND turn_deadline <= $2
          ORDER BY turn_deadline LIMIT $3 FOR UPDATE SKIP LOCKED`,
        [ACTIVE_STATES, new Date(now), limit],
      );
      for (const duel of due.rows) await this.expire({ client, duel, now, outbox });
      return due.rows.length;
    });
    await flush(outbox);
    return expired;
  }

  // ----- The Sabi Bot (FR-DUEL-6), for the workers -----

  /** Random duels nobody took within a minute get the Sabi Bot. Returns how many. */
  async seatBots(limit = 50): Promise<number> {
    const now = this.deps.clock.now();
    return withTransaction(this.deps.pool, async (client) => {
      const waiting = await client.query<DuelRow>(
        `SELECT * FROM duels
          WHERE source = 'random' AND player_b IS NULL AND created_at <= $1
            AND state IN ('created', 'wait_b_r1r2')
          ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [new Date(now - MATCH_WAIT_MS), limit],
      );
      for (const duel of waiting.rows) await this.seat(client, duel, SABI_BOT_ID, now, 'bot');
      return waiting.rows.length;
    });
  }

  /**
   * The bot's turns and tie-breaks, each played once it has waited BOT_TURN_DELAY_MS. Returns
   * how many it played. One that fails (a category out of questions, say) waits for the next run.
   */
  async playBotTurns(limit = 20): Promise<number> {
    const now = this.deps.clock.now();
    const due = await this.deps.pool.query<{ id: string }>(
      `SELECT d.id FROM duels d
        WHERE d.player_b = $1 AND d.state = ANY($2::duel_state[]) AND d.turn_deadline <= $3
          AND (d.turn_user_id = $1 OR (d.state = 'tiebreak' AND NOT EXISTS (
                SELECT 1 FROM duel_answers a WHERE a.duel_id = d.id AND a.round_no = ${TIEBREAK_ROUND}
                   AND a.user_id = $1 AND a.received_at IS NOT NULL)))
        ORDER BY d.turn_deadline LIMIT $4`,
      // A turn started at deadline − 48 h; the bot waits a little into it.
      [SABI_BOT_ID, ACTIVE_STATES, new Date(now + TURN_MS - BOT_TURN_DELAY_MS), limit],
    );
    let played = 0;
    for (const { id } of due.rows) {
      try {
        if (await this.playBotTurn(id)) played++;
      } catch (err) {
        this.deps.log.warn({ err, duel_id: id }, 'the Sabi Bot could not play its turn');
      }
    }
    return played;
  }

  private async playBotTurn(duelId: string): Promise<boolean> {
    const now = this.deps.clock.now();
    const outbox: Outbox = [];
    const played = await withTransaction(this.deps.pool, async (client) => {
      const duel = await lockDuel(client, duelId);
      const side = duel ? sideOf(duel, SABI_BOT_ID) : null;
      if (!duel || side === null || isFinished(duel.state)) return false;
      const tx: PlayerTx = { client, duel, now, outbox, viewer: SABI_BOT_ID, side };
      if (isDue(duel, now)) {
        await this.expire(tx);
        return false;
      }
      if (duel.state === 'tiebreak') return this.botTiebreak(tx);
      if (turnSide(duel.state) !== side) return false;
      // It plays at its opponent's level, for a fair game.
      const strength = await combinedRating(client, humansOf(duel));
      let streak = trailingStreak(playedRows(await getAnswers(client, [duel.id]), SABI_BOT_ID));
      for (const roundNo of roundsForTurn(duel.state)) {
        let rounds = await getRounds(client, [duel.id]);
        if (rounds.find((r) => r.round_no === roundNo)!.category_id === null) {
          // Whoever plays a round first picks it, so this one is the bot's pick.
          const offered = sample(rounds.find((r) => r.round_no === roundNo)!.offered, 3);
          let filled = false;
          for (const categoryId of offered) {
            if ((filled = await this.fillRound(tx, rounds, roundNo, categoryId, SABI_BOT_ID))) break;
          }
          if (!filled) throw new Error(`no questions for round ${roundNo} in any offered category`);
          rounds = await getRounds(client, [duel.id]);
        }
        const round = rounds.find((r) => r.round_no === roundNo)!;
        const questions = await loadQuestions(client, round.question_ids);
        const answers = await getAnswers(client, [duel.id]);
        for (const [i, qid] of round.question_ids.entries()) {
          if (findAnswer(answers, roundNo, i + 1, SABI_BOT_ID)?.received_at) continue;
          const q = questions.get(qid)!;
          const pick = botAnswer(
            { itemRating: q.d_rating, optionCount: q.options.length, correctIndex: q.correct_index! },
            strength,
            this.random,
          );
          const score = scoreAnswer({
            correct: pick.correct,
            elapsedMs: pick.elapsedMs,
            timeLimitMs: TIME_LIMIT_MS,
            streakBefore: streak,
          });
          streak = score.streakAfter;
          await client.query(
            `INSERT INTO duel_answers (duel_id, round_no, seq, user_id, question_id, served_at, received_at,
                                       client_elapsed_ms, accepted_elapsed_ms, display_index, chosen_index,
                                       correct, points)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, $12)`,
            [
              duel.id,
              roundNo,
              i + 1,
              SABI_BOT_ID,
              qid,
              new Date(now - pick.elapsedMs),
              new Date(now),
              pick.elapsedMs,
              toDisplayIndex(permFor(duel.id, SABI_BOT_ID, q), pick.chosenIndex),
              pick.chosenIndex,
              pick.correct,
              score.points,
            ],
          );
        }
        await this.afterAnswer(tx, roundNo, BOT_ACTOR);
      }
      return true;
    });
    await flush(outbox);
    return played;
  }

  /** The bot's closest-number guess; the tie-break is decided if the player already answered. */
  private async botTiebreak(tx: PlayerTx): Promise<boolean> {
    const { client, duel, now } = tx;
    if (findAnswer(await getAnswers(client, [duel.id]), TIEBREAK_ROUND, 1, SABI_BOT_ID)?.received_at) {
      return false;
    }
    const round = (await getRounds(client, [duel.id])).find((r) => r.round_no === TIEBREAK_ROUND);
    if (!round) return false;
    const q = (await loadQuestions(client, round.question_ids)).get(round.question_ids[0]!)!;
    const guess = botGuess(q.numeric_answer!, this.random);
    const elapsedMs = Math.round(5000 + this.random() * 7000);
    await client.query(
      `INSERT INTO duel_answers (duel_id, round_no, seq, user_id, question_id, served_at, received_at,
                                 client_elapsed_ms, accepted_elapsed_ms, guess, correct, points)
       VALUES ($1, ${TIEBREAK_ROUND}, 1, $2, $3, $4, $5, $6, $6, $7, $8, 0)`,
      [
        duel.id,
        SABI_BOT_ID,
        q.id,
        new Date(now - elapsedMs),
        new Date(now),
        elapsedMs,
        guess,
        guess === q.numeric_answer,
      ],
    );
    await this.resolveTiebreak(tx, q, BOT_ACTOR);
    return true;
  }

  private async expireOne(duelId: string): Promise<void> {
    const now = this.deps.clock.now();
    const outbox: Outbox = [];
    await withTransaction(this.deps.pool, async (client) => {
      const duel = await lockDuel(client, duelId);
      if (duel && isDue(duel, now)) await this.expire({ client, duel, now, outbox });
    });
    await flush(outbox);
  }

  /** The deadline passed: the waiting player wins by forfeit, or the duel is cancelled (TRD §5.2). */
  private async expire(tx: Tx): Promise<void> {
    let tiebreakAnswered: DuelSide | null = null;
    if (tx.duel.state === 'tiebreak') {
      const answered = (await getAnswers(tx.client, [tx.duel.id])).filter(
        (a) => a.round_no === TIEBREAK_ROUND && a.received_at !== null,
      );
      if (answered.length === 1) tiebreakAnswered = sideOf(tx.duel, answered[0]!.user_id);
    }
    await this.transition(tx, applyDuelEvent(snapshotOf(tx.duel), { type: 'expired', tiebreakAnswered }));
  }

  // ----- Internals -----

  /**
   * Run `work` holding the duel's row lock. Someone who is not in the duel gets a 404, as if
   * it did not exist. A duel past its deadline is expired (and that is committed) instead.
   */
  private async withDuel<T>(duelId: string, viewer: string, work: (tx: PlayerTx) => Promise<T>): Promise<T> {
    const now = this.deps.clock.now();
    const outbox: Outbox = [];
    const outcome = await withTransaction(this.deps.pool, async (client) => {
      const duel = await lockDuel(client, duelId);
      const side = duel ? sideOf(duel, viewer) : null;
      if (!duel || side === null) return { kind: 'missing' } as const;
      if (isDue(duel, now)) {
        await this.expire({ client, duel, now, outbox });
        return { kind: 'expired' } as const;
      }
      return { kind: 'done', value: await work({ client, duel, now, outbox, viewer, side }) } as const;
    });
    await flush(outbox);
    if (outcome.kind === 'missing') throw notFound('This duel does not exist.');
    if (outcome.kind === 'expired') throw duelFinished('The turn ran out of time.');
    return outcome.value;
  }

  /** After an answer: report a finished round, and hand the turn over once every round of it is done. */
  private async afterAnswer(tx: PlayerTx, roundNo: number, ctx: EventContext): Promise<void> {
    const { client, duel, viewer, side, outbox } = tx;
    const rounds = await getRounds(client, [duel.id]);
    const answers = await getAnswers(client, [duel.id]);
    const round = rounds.find((r) => r.round_no === roundNo)!;
    if (!roundFinished(round, answers, viewer)) return;

    const mine = answers.filter((a) => a.user_id === viewer && a.round_no === roundNo);
    const firstServed = Math.min(...mine.map((a) => a.served_at.getTime()));
    const lastAnswered = Math.max(...mine.map((a) => a.received_at!.getTime()));
    if (viewer !== SABI_BOT_ID) {
      outbox.push(() =>
        this.deps.events.emit(
          'duel_round_played',
          {
            duel_id: duel.id,
            round: roundNo,
            category: round.category_id!,
            correct_count: mine.filter((a) => a.correct).length,
            points: mine.reduce((sum, a) => sum + a.points, 0),
            turn_duration_s: Math.round((lastAnswered - firstServed) / 1000),
          },
          ctx,
        ),
      );
    }

    const turnDone = roundsForTurn(duel.state).every((r) =>
      roundFinished(
        rounds.find((x) => x.round_no === r),
        answers,
        viewer,
      ),
    );
    if (!turnDone) return;
    const total = (userId: string | null) =>
      userId ? playedRows(answers, userId).reduce((sum, a) => sum + a.points, 0) : 0;
    await this.transition(
      tx,
      applyDuelEvent(snapshotOf(duel), {
        type: 'turn_completed',
        side,
        scoreA: total(duel.player_a),
        scoreB: total(duel.player_b),
      }),
      ctx,
    );
  }

  /**
   * Persist a move of the state machine: the next turn and its 48 h deadline, or the result,
   * ratings and `duel_completed` events. Entering a tie-break also sets up its question. Duels
   * with the Sabi Bot are unrated.
   */
  private async transition(tx: Tx, next: DuelSnapshot, actor?: EventContext): Promise<void> {
    const { client, duel, now } = tx;
    const finished = isFinished(next.state);
    const decisive = (next.state === 'complete' || next.state === 'forfeit') && duel.player_b !== null;
    const deltas =
      decisive && duel.player_b !== SABI_BOT_ID
        ? await applyDuelRatings(client, { ...duel, player_b: duel.player_b! }, next.winner, now)
        : null;
    const updated = await client.query<DuelRow>(
      `UPDATE duels SET state = $2, score_a = $3, score_b = $4, turn_user_id = $5, turn_deadline = $6,
              winner_id = $7, rating_delta_a = $8, rating_delta_b = $9, completed_at = $10
        WHERE id = $1 RETURNING *`,
      [
        duel.id,
        next.state,
        next.scoreA,
        next.scoreB,
        finished ? null : playerFor(duel, turnSide(next.state)),
        finished ? null : new Date(now + TURN_MS),
        playerFor(duel, next.winner),
        deltas?.a ?? null,
        deltas?.b ?? null,
        finished ? new Date(now) : null,
      ],
    );
    this.deps.log.info({ duel_id: duel.id, from: duel.state, to: next.state }, 'duel moved on');
    tx.duel = updated.rows[0]!;
    if (decisive) {
      await this.reward(tx, actor);
      await this.queueCompleted(tx, actor);
    }
    if (next.state === 'tiebreak') await this.startTiebreak(tx, actor);
    await this.queuePushes(tx, duel, actor);
  }

  /**
   * Pushes for a move (FR-NOT-1), saved with it: "your turn" to whoever must play now ("X don
   * challenge you" after a direct challenger's first turn), the tie-break to the other player,
   * and the result to each player who wasn't the one to end it. The Sabi Bot gets none.
   */
  private async queuePushes(tx: Tx, before: DuelRow, actor?: EventContext): Promise<void> {
    const { client, duel, now } = tx;
    if (duel.state === before.state) return;
    // Whoever just moved needs no "your turn" or reminder still waiting (in quiet hours, say).
    if (actor?.userId) {
      await client.query(
        'DELETE FROM push_outbox WHERE user_id = $1 AND collapse_key = $2 AND sent_at IS NULL',
        [actor.userId, duelKey(duel.id)],
      );
    }
    const players = await getPlayers(client, playersOf(duel));
    const opponentOf = (userId: string) => {
      const other = duel.player_a === userId ? duel.player_b : duel.player_a;
      return other ? (players.get(other)?.username ?? null) : null;
    };
    const turn = async (userId: string, kind: 'challenge' | 'turn' | 'tiebreak') => {
      if (userId === SABI_BOT_ID) return;
      await queuePush(client, {
        userId,
        params: { type: 'your_turn', duel_id: duel.id, kind, opponent: opponentOf(userId) },
        collapseKey: duelKey(duel.id),
        expiresAt: duel.turn_deadline!.getTime(),
        now,
      });
    };

    if (duel.state === 'tiebreak') {
      for (const userId of playersOf(duel)) if (userId !== actor?.userId) await turn(userId, 'tiebreak');
    } else if (duel.turn_user_id && duel.turn_user_id !== actor?.userId) {
      await turn(duel.turn_user_id, before.state === 'created' ? 'challenge' : 'turn');
    }

    if ((duel.state === 'complete' || duel.state === 'forfeit') && duel.player_b !== null) {
      for (const side of ['a', 'b'] as const) {
        const userId = playerFor(duel, side)!;
        if (userId === actor?.userId || userId === SABI_BOT_ID) continue;
        await queuePush(client, {
          userId,
          params: {
            type: 'duel_result',
            duel_id: duel.id,
            opponent: opponentOf(userId),
            result: resultFor(duel, side)!,
            forfeit: duel.state === 'forfeit',
            you: side === 'a' ? duel.score_a : duel.score_b,
            them: side === 'a' ? duel.score_b : duel.score_a,
          },
          collapseKey: duelKey(duel.id),
          expiresAt: now + RESULT_PUSH_MS,
          now,
        });
      }
    }
  }

  /** One closest-number question for both; with none to ask, the level scores stand as a draw. */
  private async startTiebreak(tx: Tx, actor?: EventContext): Promise<void> {
    const { client, duel, now } = tx;
    const players = humansOf(duel);
    const rounds = await getRounds(client, [duel.id]);
    const qid = await pickTiebreakQuestion(client, {
      players,
      familySafeOnly: await familySafeOnly(client, players),
      exclude: rounds.flatMap((r) => r.question_ids),
      now,
    });
    if (qid === null) {
      this.deps.log.warn(
        { duel_id: duel.id },
        'no closest-number question for a tie-break; ending in a draw',
      );
      await this.transition(
        tx,
        applyDuelEvent(snapshotOf(duel), { type: 'tiebreak_resolved', winner: null }),
        actor,
      );
      return;
    }
    const q = (await loadQuestions(client, [qid])).get(qid)!;
    await client.query(
      `INSERT INTO duel_rounds (duel_id, round_no, category_id, offered, question_ids)
       VALUES ($1, ${TIEBREAK_ROUND}, $2, '{}', $3)`,
      [duel.id, q.category_id, [qid]],
    );
  }

  /** `duel_completed`, one per player (doc 13). The player who timed out gets `forfeit`. */
  /**
   * Coins and XP for a finished duel (GDD §5.1), with its result: +30 a win, +10 a loss or draw,
   * nothing for a forfeit, and XP for the answers plus 50 for seeing it through, the answers in
   * a Weekend Wahala category counting double (step 2.7h). Each level reached pays 100 more.
   * The Sabi Bot earns nothing.
   */
  private async reward(tx: Tx, actor?: EventContext): Promise<void> {
    const { client, duel, now, outbox } = tx;
    const answers = await getAnswers(client, [duel.id]);
    const players = await getPlayers(client, playersOf(duel));
    const config = await configOf(this.deps);
    const boosts = (await this.deps.liveops?.xpBoosts(now)) ?? [];
    const categoryOf = new Map((await getRounds(client, [duel.id])).map((r) => [r.round_no, r.category_id]));
    // In id order, so two duels between the same players finishing together never wait on each other.
    for (const userId of humansOf(duel).sort()) {
      const side = sideOf(duel, userId)!;
      const result = resultFor(duel, side);
      const outcome: DuelOutcome =
        result === 'loss' && duel.state === 'forfeit' ? 'forfeit' : (result ?? 'draw');
      const played = playedRows(answers, userId);
      const xp = boostedDuelXp(
        played.map((a) => ({ correct: a.correct === true, category: categoryOf.get(a.round_no) ?? null })),
        outcome !== 'forfeit',
        boosts,
      );
      const coins = duelCoins(outcome, config);
      const paid = await rewardPlayer(client, userId, {
        xp,
        coins,
        config,
        reason: outcome === 'win' ? 'duel_win' : outcome === 'draw' ? 'duel_draw' : 'duel_loss',
        key: `duel:${duel.id}:${userId}`,
        refType: 'duel',
        refId: duel.id,
        now,
      });
      if (!paid) continue;
      const updated = await client.query<DuelRow>(
        `UPDATE duels SET coins_${side} = $2, xp_${side} = $3 WHERE id = $1 RETURNING *`,
        [duel.id, coins, xp],
      );
      tx.duel = updated.rows[0]!;
      const ctx: EventContext =
        actor?.userId === userId
          ? actor
          : { userId, platform: players.get(userId)?.last_platform ?? 'android' };
      for (const change of paid.changes) {
        outbox.push(() =>
          this.deps.events.emit(
            'coins_changed',
            { delta: change.delta, reason: change.reason, balance_after: change.balance },
            ctx,
          ),
        );
      }
    }
  }

  private async queueCompleted(tx: Tx, actor?: EventContext): Promise<void> {
    const { duel, now, outbox } = tx;
    const players = await getPlayers(tx.client, playersOf(duel));
    for (const side of ['a', 'b'] as const) {
      const userId = playerFor(duel, side)!;
      if (userId === SABI_BOT_ID) continue;
      const result = resultFor(duel, side);
      const props = {
        result:
          result === 'draw'
            ? ('tie' as const)
            : result === 'win'
              ? ('win' as const)
              : duel.state === 'forfeit'
                ? ('forfeit' as const)
                : ('loss' as const),
        score_self: side === 'a' ? duel.score_a : duel.score_b,
        score_opp: side === 'a' ? duel.score_b : duel.score_a,
        rating_delta: (side === 'a' ? duel.rating_delta_a : duel.rating_delta_b) ?? 0,
        duration_total_s: Math.round((now - duel.created_at.getTime()) / 1000),
      };
      const ctx: EventContext =
        actor?.userId === userId
          ? actor
          : { userId, platform: players.get(userId)?.last_platform ?? 'android' };
      outbox.push(() => this.deps.events.emit('duel_completed', props, ctx));
    }
  }

  private async endEarly(duelId: string, viewer: string, event: 'declined' | 'cancelled'): Promise<DuelView> {
    await this.withDuel(duelId, viewer, async (tx) => {
      const { client, duel, side } = tx;
      if (side !== (event === 'declined' ? 'b' : 'a')) {
        throw conflict(
          ErrorCode.conflict,
          event === 'declined' ? 'Only the challenged player can decline' : 'Only the challenger can cancel',
        );
      }
      if (duel.state === event) return; // already done
      if (isFinished(duel.state)) throw duelFinished();
      const opponentStarted =
        duel.player_b !== null &&
        (await getAnswers(client, [duel.id])).some((a) => a.user_id === duel.player_b);
      let next: DuelSnapshot | null = null;
      try {
        if (!opponentStarted) next = applyDuelEvent(snapshotOf(duel), { type: event });
      } catch (error) {
        if (!(error instanceof DuelTransitionError)) throw error;
      }
      if (!next) {
        throw conflict(ErrorCode.duelAlreadyStarted, 'This duel has already started', 'Play it out instead.');
      }
      await this.transition(tx, next);
    });
    return this.view(duelId, viewer);
  }

  private async assertCanStart(client: PoolClient, viewer: string, opponentId: string | null): Promise<void> {
    if ((await activeDuelCount(client, viewer)) >= MAX_ACTIVE_DUELS) {
      throw conflict(
        ErrorCode.duelLimitReached,
        'You have too many duels going',
        `Finish one first: ${MAX_ACTIVE_DUELS} at a time.`,
      );
    }
    if (!opponentId) return;
    const opponent = (await getPlayers(client, [opponentId])).get(opponentId);
    if (!opponent || !['guest', 'active', 'restricted'].includes(opponent.status)) {
      throw conflict(ErrorCode.opponentUnavailable, "This player can't be challenged right now");
    }
    // A direct challenge goes to friends and past opponents; anyone else gets an invite link.
    const check = await canChallenge(client, viewer, opponentId);
    if (check === 'blocked') {
      throw conflict(ErrorCode.opponentUnavailable, "This player can't be challenged right now");
    }
    if (check === 'not_connected') {
      throw new ApiError(
        403,
        ErrorCode.friendsOnly,
        'You can challenge friends and past opponents',
        'Send an invite link instead.',
      );
    }
    if ((await activeDuelCount(client, opponentId)) >= MAX_ACTIVE_DUELS) {
      throw conflict(
        ErrorCode.duelLimitReached,
        'Your opponent has too many duels going',
        'Try again later.',
      );
    }
  }

  /**
   * `userId` takes seat B. If the challenger already played round 1, it is now B's turn, and
   * their 48 h start now.
   */
  private async seat(
    client: PoolClient,
    duel: DuelRow,
    userId: string,
    now: number,
    source: DuelSource = duel.source,
  ): Promise<void> {
    applyDuelEvent(snapshotOf(duel), { type: 'opponent_joined' });
    const theirTurn = duel.state === 'wait_b_r1r2';
    await client.query(
      `UPDATE duels SET player_b = $2, source = $5,
              turn_user_id = CASE WHEN $3 THEN $2 ELSE turn_user_id END,
              turn_deadline = CASE WHEN $3 THEN $4 ELSE turn_deadline END
        WHERE id = $1`,
      [duel.id, userId, theirTurn, new Date(now + TURN_MS), source],
    );
  }

  /** The round's questions from `categoryId`, saved with its picker; false when the category runs dry. */
  private async fillRound(
    tx: Pick<Tx, 'client' | 'duel' | 'now'>,
    rounds: readonly RoundRow[],
    roundNo: number,
    categoryId: string,
    pickedBy: string,
  ): Promise<boolean> {
    const { client, duel, now } = tx;
    const players = humansOf(duel);
    const ids = await pickRoundQuestions(client, categoryId, {
      players,
      familySafeOnly: await familySafeOnly(client, players),
      exclude: rounds.flatMap((r) => r.question_ids),
      now,
    });
    if (ids.length < QUESTIONS_PER_ROUND) return false;
    await client.query(
      `UPDATE duel_rounds SET category_id = $3, picked_by = $4, question_ids = $5
        WHERE duel_id = $1 AND round_no = $2`,
      [duel.id, roundNo, categoryId, pickedBy, ids],
    );
    return true;
  }

  /** Once both have answered the tie-break, the closest guess decides the duel. Returns the answers. */
  private async resolveTiebreak(tx: Tx, q: DuelQuestion, actor: EventContext): Promise<AnswerRow[]> {
    const { client, duel } = tx;
    const answered = (await getAnswers(client, [duel.id])).filter(
      (a) => a.round_no === TIEBREAK_ROUND && a.received_at !== null,
    );
    if (answered.length === 2) {
      const of = (s: DuelSide) => answered.find((a) => a.user_id === playerFor(duel, s))!;
      const winner = tiebreakWinner(q.numeric_answer!, of('a'), of('b'));
      await this.transition(
        tx,
        applyDuelEvent(snapshotOf(tx.duel), { type: 'tiebreak_resolved', winner }),
        actor,
      );
    }
    return answered;
  }

  private async insertDuel(
    client: PoolClient,
    input: { playerA: string; playerB: string | null; source: DuelSource; rematchOf?: string; now: number },
  ): Promise<string> {
    const id = newId('d', input.now);
    const token = input.source === 'link' ? randomBytes(16).toString('base64url') : null;
    await client.query(
      `INSERT INTO duels (id, player_a, player_b, invite_token, source, state, turn_user_id, turn_deadline,
                          rematch_of, created_at)
       VALUES ($1, $2, $3, $4, $5, 'created', $2, $6, $7, $8)`,
      [
        id,
        input.playerA,
        input.playerB,
        token,
        input.source,
        new Date(input.now + TURN_MS),
        input.rematchOf ?? null,
        new Date(input.now),
      ],
    );
    // Each round offers 3 of the categories at random (GDD §2.1).
    const categories = await client.query<{ id: string }>('SELECT id FROM categories WHERE active');
    for (const roundNo of DUEL_ROUNDS) {
      await client.query(
        `INSERT INTO duel_rounds (duel_id, round_no, offered, question_ids) VALUES ($1, $2, $3, '{}')`,
        [
          id,
          roundNo,
          sample(
            categories.rows.map((c) => c.id),
            3,
          ),
        ],
      );
    }
    return id;
  }

  private async answerResponse(tx: PlayerTx, row: AnswerRow): Promise<DuelAnswerResponse> {
    const { client, duel, viewer } = tx;
    const answers = await getAnswers(client, [duel.id]);
    const q = (await loadQuestions(client, [row.question_id])).get(row.question_id)!;
    const played = playedRows(answers, viewer);
    const index = played.findIndex((a) => a.round_no === row.round_no && a.seq === row.seq);
    // Recomputed from the stored row, so a replay matches the first response exactly.
    const score = scoreAnswer({
      correct: Boolean(row.correct),
      elapsedMs: row.accepted_elapsed_ms!,
      timeLimitMs: TIME_LIMIT_MS,
      streakBefore: trailingStreak(played.slice(0, index)),
    });
    const data: DuelData = { duel, rounds: await getRounds(client, [duel.id]), answers, players: new Map() };
    return {
      correct: Boolean(row.correct),
      timed_out: timingOf(row).timedOut,
      correct_display_index: toDisplayIndex(permFor(duel.id, viewer, q), q.correct_index!),
      points: row.points,
      breakdown: { base: score.base, speed: score.speed, streak: score.streak },
      fact: q.fact,
      running_score: played.slice(0, index + 1).reduce((sum, a) => sum + a.points, 0),
      streak: score.streakAfter,
      next: nextAction(data, viewer),
    };
  }

  private async tiebreakResponse(tx: PlayerTx, row: AnswerRow): Promise<TiebreakAnswerResponse> {
    const q = (await loadQuestions(tx.client, [row.question_id])).get(row.question_id)!;
    const decided = isFinished(tx.duel.state);
    return {
      guess: row.guess,
      timed_out: row.guess === null,
      answer: q.numeric_answer!,
      fact: q.fact,
      decided,
      result: decided ? resultFor(tx.duel, tx.side) : null,
    };
  }

  private async view(duelId: string, viewer: string): Promise<DuelView> {
    const [data] = await this.load(this.deps.pool, [duelId]);
    if (!data) throw notFound('This duel does not exist.');
    const questions = await loadQuestions(this.deps.pool, visibleQuestionIds(data, viewer));
    return buildView(data, viewer, questions, this.deps.config.publicWebUrl);
  }

  private async load(db: Pool | PoolClient, duelIds: readonly string[]): Promise<DuelData[]> {
    if (duelIds.length === 0) return [];
    const duels = await db.query<DuelRow>('SELECT * FROM duels WHERE id = ANY($1)', [duelIds]);
    const rounds = await getRounds(db, duelIds);
    const answers = await getAnswers(db, duelIds);
    const players = await getPlayers(db, duels.rows.flatMap(playersOf));
    const byId = new Map(duels.rows.map((d) => [d.id, d]));
    return duelIds.flatMap((id) => {
      const duel = byId.get(id);
      if (!duel) return [];
      return [
        {
          duel,
          rounds: rounds.filter((r) => r.duel_id === id),
          answers: answers.filter((a) => a.duel_id === id),
          players,
        },
      ];
    });
  }
}

function findAnswer(answers: readonly AnswerRow[], roundNo: number, seq: number, userId: string) {
  return answers.find((a) => a.round_no === roundNo && a.seq === seq && a.user_id === userId);
}

function assertEarlierRoundsDone(
  turnRounds: readonly number[],
  roundNo: number,
  rounds: readonly RoundRow[],
  answers: readonly AnswerRow[],
  viewer: string,
): void {
  for (const earlier of turnRounds) {
    if (earlier === roundNo) return;
    const round = rounds.find((r) => r.round_no === earlier);
    if (!roundFinished(round, answers, viewer)) {
      throw conflict(ErrorCode.outOfOrder, `Finish round ${earlier} first`);
    }
  }
}

/** A repeat of an answer with a different Idempotency-Key is a second answer, and refused (doc 14 §4.2). */
function assertSameRequest(row: AnswerRow, idempotencyKey: string | undefined): void {
  if (idempotencyKey && row.idempotency_key && idempotencyKey !== row.idempotency_key) {
    throw conflict(ErrorCode.alreadyAnswered, 'This question is already answered');
  }
}

/** Correct answers in a row at the end of `played` (the streak carried into the next question). */
function trailingStreak(played: readonly AnswerRow[]): number {
  let streak = 0;
  for (let i = played.length - 1; i >= 0 && played[i]!.correct; i--) streak++;
  return streak;
}

/** The timing verdict again, from the stored raw values. It is deterministic, so replays match. */
function timingOf(row: AnswerRow) {
  return acceptElapsed({
    clientElapsedMs: row.client_elapsed_ms,
    serverElapsedMs: Math.max(0, row.received_at!.getTime() - row.served_at.getTime()),
    rttEstMs: row.rtt_est_ms ?? 0,
    timeLimitMs: TIME_LIMIT_MS + row.extra_ms,
    offlineGraceMs: OFFLINE_RESEND_GRACE_MS,
  });
}

function tiebreakWinner(answer: number, a: AnswerRow, b: AnswerRow): DuelSide | null {
  if (a.guess === null && b.guess === null) return null;
  if (a.guess === null) return 'b';
  if (b.guess === null) return 'a';
  return resolveTiebreak(
    answer,
    { guess: a.guess, elapsedMs: a.accepted_elapsed_ms ?? TIME_LIMIT_MS },
    { guess: b.guess, elapsedMs: b.accepted_elapsed_ms ?? TIME_LIMIT_MS },
  );
}

function permFor(duelId: string, userId: string, q: DuelQuestion): number[] {
  return optionPermutation(q.options.length, shuffleSeed(duelId, userId, q.id));
}

function playersOf(duel: DuelRow): string[] {
  return duel.player_b ? [duel.player_a, duel.player_b] : [duel.player_a];
}

/** Whether the two are in a duel together already: random play should bring someone new. */
async function playingAlready(client: PoolClient, a: string, b: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM duels WHERE state = ANY($3::duel_state[])
        AND ((player_a = $1 AND player_b = $2) OR (player_a = $2 AND player_b = $1)) LIMIT 1`,
    [a, b, ACTIVE_STATES],
  );
  return result.rows.length > 0;
}

async function familySafeOnly(client: PoolClient, players: readonly string[]): Promise<boolean> {
  return [...(await getPlayers(client, players)).values()].some((p) => p.family_mode);
}

function sample<T>(items: readonly T[], n: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}

async function flush(outbox: Outbox): Promise<void> {
  for (const job of outbox) await job();
}

function encodeCursor(atMs: number, id: string): string {
  return Buffer.from(JSON.stringify([atMs, id])).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: number; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [unknown, unknown];
    if (typeof at === 'number' && typeof id === 'string') return { at, id };
  } catch {
    // fall through
  }
  throw new ApiError(400, ErrorCode.validation, 'The request is not valid', 'cursor: not recognised');
}
