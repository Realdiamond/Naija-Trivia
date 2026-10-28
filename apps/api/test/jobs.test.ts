import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId, serverEventRow } from '@whosabi/analytics/server';
import { watDate } from '@whosabi/game-rules';
import type { CreateDuelResponse } from '@whosabi/shared-types';
import { recordQuestionStats } from '../src/content/stats';
import { DuelService, type DuelDeps } from '../src/duels/service';
import { ServerEvents } from '../src/events';
import { AnalyticsLoader } from '../src/jobs/analyticsLoader';
import { expireDueDuels } from '../src/jobs/expiry';
import { flushQuestionStats } from '../src/jobs/questionStats';
import { queueTurnReminders } from '../src/jobs/reminders';
import { sendDuePushes } from '../src/push/dispatch';
import { inQuietHours } from '../src/push/queue';
import { LogTransport } from '../src/push/transport';
import { befriend, bearer, createTestApp, signInGuest } from './helpers';
import { givePhone, TestTransport } from './pushHelpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let t: Awaited<ReturnType<typeof createTestApp>>;
let deps: DuelDeps;
beforeAll(async () => {
  t = await createTestApp();
  deps = {
    config: t.config,
    pool: t.pool,
    redis: t.redis,
    clock: t.clock,
    events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
    log: t.app.log,
  };
});
afterAll(() => t.close());

/** Sets the shared clock to a WAT wall time on a fresh day, ahead of anything earlier in the file. */
let day = 10;
function startDayAt(watHour: number) {
  t.clock.t = Date.UTC(2026, 10, ++day, watHour - 1, 0, 0);
}

async function duelBetween() {
  const a = await signInGuest(t.app);
  const b = await signInGuest(t.app);
  await befriend(t.pool, a.user.id, b.user.id);
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/duels',
    headers: bearer(a.access),
    payload: { opponent: { user_id: b.user.id } },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { a: a.user.id, b: b.user.id, duelId: (res.json() as CreateDuelResponse).duel.id };
}

async function eventsOf(userId: string) {
  const pid = pseudonymousId(userId, t.config.analyticsKey);
  const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
  return entries
    .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
    .filter((row) => row.user_pid === pid)
    .map((row) => ({ event: row.event as string, props: JSON.parse(row.props as string) }));
}

describe('turn reminders', () => {
  /** Runs the reminder job, then the push job, as the worker does. */
  async function remindAndSend(transport: TestTransport) {
    await queueTurnReminders(deps);
    await sendDuePushes(deps, transport);
  }

  it('reminds the player whose turn it is at 24 h and 4 h left, once each, never in quiet hours', async () => {
    startDayAt(9);
    const { a, b } = await duelBetween();
    const [phoneA, phoneB] = [await givePhone(t.pool, a), await givePhone(t.pool, b)];
    await t.pool.query("UPDATE users SET username = 'ChidiOfLagos' WHERE id = $1", [b]);
    const transport = new TestTransport();

    t.clock.advance(25 * HOUR); // 23 hours left, 10:00 WAT
    await remindAndSend(transport);
    expect(transport.to(phoneA)).toEqual([
      expect.objectContaining({
        type: 'duel_expiring',
        title: '24 hours left vs ChidiOfLagos',
        // A challenger who never played their first turn loses the duel, not to the opponent.
        body: 'Play your turn before time runs out, or the duel is cancelled.',
      }),
    ]);
    expect(transport.to(phoneB)).toEqual([]);
    await remindAndSend(transport);
    expect(transport.to(phoneA)).toHaveLength(1);

    t.clock.advance(18 * HOUR); // 5 hours left, 04:00 WAT
    t.clock.advance(2 * HOUR); // 3 hours left, 06:00 WAT: quiet hours
    expect(inQuietHours(t.clock.now())).toBe(true);
    await remindAndSend(transport);
    expect(transport.to(phoneA)).toHaveLength(1);

    t.clock.advance(HOUR); // 2 hours left, 07:00 WAT
    await remindAndSend(transport);
    expect(transport.to(phoneA).map((m) => m.title)).toEqual([
      '24 hours left vs ChidiOfLagos',
      '4 hours left vs ChidiOfLagos',
    ]);
    expect((await eventsOf(a)).filter((e) => e.event === 'push_sent')).toEqual([
      { event: 'push_sent', props: { type: 'duel_expiring' } },
      { event: 'push_sent', props: { type: 'duel_expiring' } },
    ]);
  });

  it('names the opponent who wins on time, in Pidgin for a player who chose it', async () => {
    startDayAt(9);
    const { a, b, duelId } = await duelBetween();
    const phoneB = await givePhone(t.pool, b);
    // Round 1 played: the turn passes to B (doc 03 §2.1), and the time limit now decides a winner.
    await t.pool.query("UPDATE duels SET state = 'wait_b_r1r2', turn_user_id = $2 WHERE id = $1", [
      duelId,
      b,
    ]);
    await t.pool.query("UPDATE users SET username = 'ToluSabi' WHERE id = $1", [a]);
    await t.pool.query("UPDATE users SET language = 'pcm' WHERE id = $1", [b]);
    const transport = new TestTransport();

    t.clock.advance(25 * HOUR);
    await remindAndSend(transport);
    expect(transport.to(phoneB)).toEqual([
      expect.objectContaining({
        type: 'duel_expiring',
        title: 'Oya o! 24 hours remain for your duel with ToluSabi',
        body: 'Play your turn before time finish, or ToluSabi go win am.',
        url: `/duel/${duelId}`,
        channel: 'duels',
        data: { duel_id: duelId },
      }),
    ]);
  });

  it('tries again shortly when the push service could not take it', async () => {
    startDayAt(9);
    const { a } = await duelBetween();
    const phone = await givePhone(t.pool, a);
    const transport = new TestTransport();
    t.clock.advance(25 * HOUR);
    transport.failNext(phone, 'transient');
    await remindAndSend(transport);
    expect(transport.to(phone)).toEqual([]);
    t.clock.advance(61_000);
    await remindAndSend(transport);
    expect(transport.to(phone).map((m) => m.title)).toEqual(['24 hours left vs your opponent']);
  });
});

describe('turn reminders before real pushes exist', () => {
  it("logs the message and doesn't count it as a push sent", async () => {
    startDayAt(9);
    const { a } = await duelBetween();
    await givePhone(t.pool, a);
    t.clock.advance(25 * HOUR);
    expect(await queueTurnReminders(deps)).toBeGreaterThanOrEqual(1);
    await sendDuePushes(deps, new LogTransport(t.app.log));
    expect((await eventsOf(a)).filter((e) => e.event === 'push_sent')).toEqual([]);
    const claimed = await t.pool.query('SELECT stage FROM duel_reminders WHERE user_id = $1', [a]);
    expect(claimed.rows).toEqual([{ stage: '24h' }]);
    const outbox = await t.pool.query('SELECT outcome FROM push_outbox WHERE user_id = $1', [a]);
    expect(outbox.rows).toEqual([{ outcome: 'logged' }]);
  });
});

describe('duel expiry', () => {
  it('ends every overdue duel, a batch at a time', async () => {
    startDayAt(9);
    const duels = await Promise.all([duelBetween(), duelBetween(), duelBetween()]);
    t.clock.advance(49 * HOUR);
    expect(await expireDueDuels(new DuelService(deps), 2)).toBeGreaterThanOrEqual(3);
    const states = await t.pool.query('SELECT state FROM duels WHERE id = ANY($1)', [
      duels.map((d) => d.duelId),
    ]);
    // Nobody played a turn, so there is no one to award the win to.
    expect(states.rows.map((r) => r.state)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });
});

describe('question stats', () => {
  async function statsOf(qid: string) {
    return (
      await t.pool.query(
        'SELECT plays::int, correct::int, option_counts, avg_elapsed_ms FROM question_stats WHERE question_id = $1',
        [qid],
      )
    ).rows[0];
  }
  const answer = (qid: string, correct: boolean, acceptedMs: number, canonicalIndex: number | null) =>
    recordQuestionStats(t.redis, t.app.log, qid, { correct, acceptedMs, canonicalIndex });

  it('adds the Redis counters into question_stats, and finishes a flush that died halfway', async () => {
    await flushQuestionStats(deps); // whatever earlier tests left
    const qid = (
      await t.pool.query(
        `SELECT q.id FROM questions q LEFT JOIN question_stats s ON s.question_id = q.id
          WHERE s.question_id IS NULL AND q.type = 'mcq4' LIMIT 1`,
      )
    ).rows[0].id as string;

    await answer(qid, true, 2000, 0);
    await answer(qid, false, 4000, 2);
    await answer(qid, false, 6000, null); // a timeout
    expect(await flushQuestionStats(deps)).toBeGreaterThanOrEqual(1);
    expect(await statsOf(qid)).toEqual({
      plays: 3,
      correct: 1,
      option_counts: [1, 0, 1, 0],
      avg_elapsed_ms: 4000,
    });
    expect(await t.redis.exists(`qstat:${qid}`, `qstatf:${qid}`)).toBe(0);

    await answer(qid, true, 8000, 1);
    // A flush that renamed its counter but died before writing it.
    await t.redis.hset(`qstatf:${qid}`, { plays: 2, correct: 2, elapsed_ms_sum: 4000, option_1: 2 });
    await flushQuestionStats(deps);
    expect(await statsOf(qid)).toEqual({
      plays: 6,
      correct: 4,
      option_counts: [1, 3, 1, 0],
      avg_elapsed_ms: 4000,
    });
  });

  it('counts each answer once when two workers flush at the same time, and waits for a held lock', async () => {
    const qid = (await t.pool.query("SELECT id FROM questions WHERE type = 'mcq4' LIMIT 1")).rows[0]
      .id as string;
    await flushQuestionStats(deps);
    const before = (await statsOf(qid))?.plays ?? 0;
    for (let i = 0; i < 5; i++) await answer(qid, true, 1000, 0);
    await Promise.all([flushQuestionStats(deps), flushQuestionStats(deps)]);
    await flushQuestionStats(deps);
    expect((await statsOf(qid)).plays).toBe(before + 5);

    await t.redis.set('lock:qstat-flush', 'someone-else', 'PX', 60_000);
    await answer(qid, true, 1000, 0);
    expect(await flushQuestionStats(deps)).toBe(0);
    expect(await t.redis.exists(`qstat:${qid}`)).toBe(1);
    await t.redis.del('lock:qstat-flush');
    await flushQuestionStats(deps);
    expect((await statsOf(qid)).plays).toBe(before + 6);
  });
});

describe('analytics loader', () => {
  const stream = 'ev:test-loader';
  const row = (pid: string, atMs: number) =>
    serverEventRow(
      'push_sent',
      { type: 'duel_expiring' },
      { eventId: randomUUID(), atMs, platform: 'android', userPid: pid },
    );
  const add = (rows: unknown[] | string) =>
    t.redis.xadd(stream, '*', 'rows', typeof rows === 'string' ? rows : JSON.stringify(rows));

  it('stores each event once, skips what is not valid, and empties the stream', async () => {
    startDayAt(12);
    await t.redis.del(stream);
    const loader = new AnalyticsLoader(deps, { stream, group: 'loader', consumer: 'one', claimIdleMs: 0 });
    await loader.ensureGroup();
    await loader.ensureGroup(); // a second worker starting up

    const now = t.clock.now();
    const first = row('pid-a', now);
    const second = row('pid-a', now + 1000);
    const odd = { ...row('pid-b', now + 2000), seq: 'seven', props: 'not json' };
    await add([first, second]);
    await add([first, odd, { event_id: '', event: 'push_sent' }]);
    await add('not json');

    expect(await loader.loadOnce()).toBe(3);
    expect(await loader.loadOnce()).toBe(0);
    expect(await t.redis.xlen(stream)).toBe(0);
    const stored = await t.pool.query(
      'SELECT event_id, seq, props FROM analytics_events WHERE event_id = ANY($1) ORDER BY ts',
      [[first.event_id, second.event_id, odd.event_id]],
    );
    expect(stored.rows).toEqual([
      { event_id: first.event_id, seq: 0, props: { type: 'duel_expiring' } },
      { event_id: second.event_id, seq: 0, props: { type: 'duel_expiring' } },
      // A bad field doesn't cost the event, only that field.
      { event_id: odd.event_id, seq: 0, props: {} },
    ]);
  });

  it('takes over entries a loader read but never acknowledged', async () => {
    const loader = new AnalyticsLoader(deps, { stream, group: 'loader', consumer: 'one', claimIdleMs: 0 });
    const orphan = row('pid-c', t.clock.now() + 3000);
    await add([orphan]);
    // Another loader reads it and dies before storing it.
    await t.redis.call('XREADGROUP', 'GROUP', 'loader', 'two', 'COUNT', 10, 'STREAMS', stream, '>');
    expect(await loader.loadOnce()).toBe(1);
    expect((await t.redis.xpending(stream, 'loader'))[0]).toBe(0);
  });

  it('keeps daily counts and drops raw events after the retention period', async () => {
    const loader = new AnalyticsLoader(deps, { stream, group: 'loader', consumer: 'one', claimIdleMs: 0 });
    const day = watDate(t.clock.now());
    await loader.rollupDay(day);
    await loader.rollupDay(day); // counting a day again replaces its numbers
    const counts = await t.pool.query(
      "SELECT events::int, players::int FROM analytics_daily WHERE day = $1 AND platform = 'android' AND event = 'push_sent'",
      [day],
    );
    expect(counts.rows).toEqual([{ events: 4, players: 3 }]);

    const old = row('pid-d', t.clock.now() - 61 * DAY);
    await add([old]);
    await loader.loadOnce();
    expect(await loader.deleteOldEvents(60)).toBeGreaterThanOrEqual(1);
    const left = await t.pool.query('SELECT count(*)::int AS n FROM analytics_events WHERE event_id = $1', [
      old.event_id,
    ]);
    expect(left.rows[0].n).toBe(0);
    expect(
      (
        await t.pool.query('SELECT count(*)::int AS n FROM analytics_events WHERE ts >= $1', [
          new Date(t.clock.now()),
        ])
      ).rows[0].n,
    ).toBe(4);
    expect(
      (await t.pool.query('SELECT 1 FROM analytics_daily WHERE day = $1', [day])).rowCount,
    ).toBeGreaterThan(0);
  });
});
