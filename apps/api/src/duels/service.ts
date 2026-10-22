/**
 * The async duel (GDD §2.1, TRD §4.3 and §5.2–5.4). Every change runs in one transaction
 * that locks the duel's row, so the two players' requests never interleave, and turns move
 * only through the `game-rules` state machine. Analytics events and question stats are sent
 * after the commit, so nothing is ever reported for work that was rolled back.
 *
 * Expiry runs in two places: `expireDue` for the workers (build plan step 1.3), and lazily
 * whenever someone touches a duel that is past its deadline.
 */
import { randomBytes, randomInt } from 'node:crypto';
import {
  acceptElapsed,
  applyDuelEvent,
  categoryPicker,
  DEFAULT_CONFIG,
  displayOrder,
  DUEL_ROUNDS,
  DuelTransitionError,
  isFinished,
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
  type ListDuelsQuery,
  type ListDuelsResponse,
  type ServedQuestion,
  type TiebreakAnswerRequest,
  type TiebreakAnswerResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { recordQuestionStats } from '../content/stats';
import { withTransaction, type Pool, type PoolClient } from '../db';
import { ApiError, conflict, notFound } from '../errors';
import type { EventContext } from '../events';
import { newId } from '../ids';
import {
  loadQuestions,
  markSeen,
  pickRoundQuestions,
  pickTiebreakQuestion,
  type DuelQuestion,
} from './questions';
import { rttFor } from '../rtt';
import { canChallenge, isBlocked } from '../social/graph';
import { applyDuelRatings } from './ratings';
import {
  ACTIVE_STATES,
  activeDuelCount,
  FINISHED_STATES,
  getAnswers,
  getDuel,
  getPlayers,
  getRounds,
  isDue,
  lockDuel,
  lockPlayers,
  playedRows,
  playerFor,
  roundFinished,
  sideOf,
  snapshotOf,
  type AnswerRow,
  type DuelRow,
  type RoundRow,
} from './repo';
import { buildSummary, buildView, nextAction, resultFor, visibleQuestionIds, type DuelData } from './view';

/** PRD US-3 AC4: up to 20 duels going at once (the Sabi Pass lifts this in v1.1). */
export const MAX_ACTIVE_DUELS = 20;
const TURN_MS = DEFAULT_CONFIG['duel.turn_expiry_h'] * 3_600_000;
const TIME_LIMIT_MS = DEFAULT_CONFIG['duel.timer_text_s'] * 1000;

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

const duelFinished = (detail?: string) => conflict(ErrorCode.duelFinished, 'This duel is over', detail);
const turnNotYours = (detail?: string) => conflict(ErrorCode.turnNotYours, 'It is not your turn', detail);

export class DuelService {
  constructor(private readonly deps: AppDeps) {}

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
      applyDuelEvent(snapshotOf(duel), { type: 'opponent_joined' });
      // If the challenger already played round 1, it is now the new player's turn: their 48 h start now.
      const theirTurn = duel.state === 'wait_b_r1r2';
      await client.query(
        `UPDATE duels SET player_b = $2,
                turn_user_id = CASE WHEN $3 THEN $2 ELSE turn_user_id END,
                turn_deadline = CASE WHEN $3 THEN $4 ELSE turn_deadline END
          WHERE id = $1`,
        [duel.id, viewer, theirTurn, new Date(now + TURN_MS)],
      );
      return { kind: 'done', id: duel.id } as const;
    });
    await flush(outbox);
    if (outcome.kind === 'missing') throw notFound('This challenge link does not exist.');
    if (outcome.kind === 'expired') throw duelFinished('The challenge ran out of time.');
    return this.view(outcome.id, viewer);
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
      const players = playersOf(duel);
      const ids = await pickRoundQuestions(client, categoryId, {
        players,
        familySafeOnly: await familySafeOnly(client, players),
        exclude: rounds.flatMap((r) => r.question_ids),
        now,
      });
      if (ids.length < QUESTIONS_PER_ROUND) {
        throw new ApiError(
          503,
          ErrorCode.noQuestions,
          'No questions are available right now',
          'Pick another category or try again soon.',
        );
      }
      await client.query(
        `UPDATE duel_rounds SET category_id = $3, picked_by = $4, question_ids = $5
          WHERE duel_id = $1 AND round_no = $2`,
        [duel.id, roundNo, categoryId, viewer, ids],
      );
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

      const qid = round.question_ids[seq - 1]!;
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
        servedAt = findAnswer(answers, roundNo, seq, viewer)!.served_at;
      }
      const numeric = q.type === 'closest_number';
      return {
        qid,
        seq,
        total: round.question_ids.length,
        type: q.type,
        category_id: q.category_id,
        text: q.text,
        options: numeric ? [] : displayOrder(q.options, permFor(duel.id, viewer, q)),
        media: null,
        time_limit_ms: TIME_LIMIT_MS,
        served_at: servedAt.toISOString(),
      };
    });
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
        timeLimitMs: TIME_LIMIT_MS,
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
      outbox.push(() =>
        recordQuestionStats(this.deps.redis, this.deps.log, q.id, {
          correct,
          acceptedMs: timing.acceptedMs,
          canonicalIndex: chosen,
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
            points: score.points,
            mode: 'duel',
            lifeline: null,
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

      const answered = (await getAnswers(client, [duel.id])).filter(
        (a) => a.round_no === TIEBREAK_ROUND && a.received_at !== null,
      );
      if (answered.length === 2) {
        const of = (s: DuelSide) => answered.find((a) => a.user_id === playerFor(duel, s))!;
        const winner = tiebreakWinner(q.numeric_answer!, of('a'), of('b'));
        await this.transition(
          tx,
          applyDuelEvent(snapshotOf(tx.duel), { type: 'tiebreak_resolved', winner }),
          ctx,
        );
      }
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
   * ratings and `duel_completed` events. Entering a tie-break also sets up its question.
   */
  private async transition(tx: Tx, next: DuelSnapshot, actor?: EventContext): Promise<void> {
    const { client, duel, now } = tx;
    const finished = isFinished(next.state);
    const decisive = (next.state === 'complete' || next.state === 'forfeit') && duel.player_b !== null;
    const deltas = decisive
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
    if (decisive) await this.queueCompleted(tx, actor);
    if (next.state === 'tiebreak') await this.startTiebreak(tx, actor);
  }

  /** One closest-number question for both; with none to ask, the level scores stand as a draw. */
  private async startTiebreak(tx: Tx, actor?: EventContext): Promise<void> {
    const { client, duel, now } = tx;
    const players = playersOf(duel);
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
  private async queueCompleted(tx: Tx, actor?: EventContext): Promise<void> {
    const { duel, now, outbox } = tx;
    const players = await getPlayers(tx.client, playersOf(duel));
    for (const side of ['a', 'b'] as const) {
      const userId = playerFor(duel, side)!;
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
    timeLimitMs: TIME_LIMIT_MS,
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
