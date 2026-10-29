import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type {
  CreateDuelResponse,
  DuelAnswerResponse,
  DuelView,
  ServedQuestion,
  SignInResponse,
  Wallet,
  WalletHistory,
} from '@whosabi/shared-types';
import { withTransaction } from '../src/db';
import { DuelService } from '../src/duels/service';
import { grantCoins, spendCoins } from '../src/economy/ledger';
import { ApiError } from '../src/errors';
import { ServerEvents } from '../src/events';
import type { JobDeps } from '../src/jobs/deps';
import { expireDueDuels } from '../src/jobs/expiry';
import { checkLedger } from '../src/jobs/ledgerCheck';
import { befriend, bearer, createTestApp, signInGuest } from './helpers';

const HOUR = 3_600_000;

let t: Awaited<ReturnType<typeof createTestApp>>;
let deps: JobDeps;
beforeAll(async () => {
  // Code sends share one per-address limit across the test files; this file isn't testing it.
  t = await createTestApp({ OTP_SENDS_PER_IP_PER_HOUR: '10000' });
  deps = {
    pool: t.pool,
    redis: t.redis,
    clock: t.clock,
    events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
    log: t.app.log,
  };
});
afterAll(() => t.close());

interface Player {
  id: string;
  access: string;
  deviceId: string;
}

async function player(): Promise<Player> {
  const guest = await signInGuest(t.app, 'android');
  return { id: guest.user.id, access: guest.access, deviceId: guest.deviceId };
}

async function wake(...players: Player[]): Promise<void> {
  for (const p of players) p.access = (await signInGuest(t.app, 'android', p.deviceId)).access;
}

const req = (p: Player | null, method: 'GET' | 'POST', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: p ? bearer(p.access) : {}, ...(payload ? { payload } : {}) });

const getDuel = async (p: Player, id: string) => (await req(p, 'GET', `/v1/duels/${id}`)).json() as DuelView;
const wallet = async (p: Player) => (await req(p, 'GET', '/v1/wallet')).json() as Wallet;
const history = async (p: Player, before?: string) =>
  (await req(p, 'GET', `/v1/wallet/history${before ? `?before=${before}` : ''}`)).json() as WalletHistory;

async function rightIndex(q: ServedQuestion): Promise<number> {
  const row = (
    await t.pool.query<{ options: string[]; correct_index: number }>(
      'SELECT options, correct_index FROM questions WHERE id = $1',
      [q.qid],
    )
  ).rows[0]!;
  return q.options.indexOf(row.options[row.correct_index]!);
}

/** Everything the player can do now, answering every question right or every one wrong. */
async function playTurn(p: Player, duelId: string, mode: 'right' | 'wrong'): Promise<void> {
  let next = (await getDuel(p, duelId)).next;
  while (next && (next.action === 'pick_category' || next.action === 'play')) {
    if (next.action === 'pick_category') {
      const res = await req(p, 'POST', `/v1/duels/${duelId}/rounds/${next.round}/category`, {
        category_id: next.offered[0],
      });
      expect(res.statusCode, res.body).toBe(200);
      next = (res.json() as DuelView).next;
      continue;
    }
    const served = (
      await req(p, 'POST', `/v1/duels/${duelId}/rounds/${next.round}/questions/${next.seq}/serve`)
    ).json() as ServedQuestion;
    const right = await rightIndex(served);
    t.clock.advance(3000);
    const res = await req(
      p,
      'POST',
      `/v1/duels/${duelId}/rounds/${next.round}/questions/${next.seq}/answer`,
      {
        display_index: mode === 'right' ? right : (right + 1) % served.options.length,
        client_elapsed_ms: 2800,
      },
    );
    expect(res.statusCode, res.body).toBe(200);
    next = (res.json() as DuelAnswerResponse).next;
  }
}

/** A direct duel played to the end: the winner answers everything right, the loser everything wrong. */
async function duel(winner: Player, loser: Player): Promise<string> {
  await befriend(t.pool, winner.id, loser.id);
  const res = await req(winner, 'POST', '/v1/duels', { opponent: { user_id: loser.id } });
  expect(res.statusCode, res.body).toBe(201);
  const id = (res.json() as CreateDuelResponse).duel.id;
  for (let turns = 0; turns < 6; turns++) {
    await playTurn(winner, id, 'right');
    await playTurn(loser, id, 'wrong');
  }
  expect((await getDuel(winner, id)).state).toBe('complete');
  return id;
}

async function coinEvents(userId: string) {
  const pid = pseudonymousId(userId, t.config.analyticsKey);
  const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
  return entries
    .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
    .filter((row) => row.user_pid === pid && row.event === 'coins_changed')
    .map((row) => JSON.parse(row.props as string) as Record<string, unknown>);
}

const xpOf = async (id: string) =>
  (await t.pool.query<{ xp: string; level: number }>('SELECT xp, level FROM users WHERE id = $1', [id]))
    .rows[0]!;

/** Transactions whose entries don't add up to zero: there must never be any. */
async function unbalanced(): Promise<number> {
  const rows = await t.pool.query(
    `SELECT e.transaction_id FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
      GROUP BY e.transaction_id, a.currency HAVING sum(e.amount) <> 0`,
  );
  return rows.rowCount ?? 0;
}

describe('coins from duels (step 2.4a)', () => {
  it('pays the winner 30 and the loser 10, with XP for their answers, once', async () => {
    const [a, b] = [await player(), await player()];
    const id = await duel(a, b);

    // 9 right answers and finishing: 9 × 10 + 50; 9 wrong ones: 9 × 2 + 50.
    expect((await getDuel(a, id)).reward).toEqual({ coins: 30, xp: 140 });
    expect((await getDuel(b, id)).reward).toEqual({ coins: 10, xp: 68 });
    expect(await wallet(a)).toEqual({ coins: 30, gems: 0 });
    expect(await wallet(b)).toEqual({ coins: 10, gems: 0 });
    expect(await xpOf(a.id)).toEqual({ xp: '140', level: 1 });
    expect(await xpOf(b.id)).toEqual({ xp: '68', level: 1 });

    expect((await history(a)).items).toEqual([
      expect.objectContaining({
        amount: 30,
        currency: 'coins',
        reason: 'duel_win',
        ref_type: 'duel',
        ref_id: id,
      }),
    ]);
    expect((await history(b)).items).toEqual([
      expect.objectContaining({ amount: 10, reason: 'duel_loss', ref_type: 'duel', ref_id: id }),
    ]);
    expect(await coinEvents(a.id)).toEqual([{ delta: 30, reason: 'duel_win', balance_after: 30 }]);
    expect(await unbalanced()).toBe(0);
  });

  it('pays 100 more for each level reached', async () => {
    const [a, b, c] = [await player(), await player(), await player()];
    await duel(a, b);
    await duel(a, c);
    // 280 XP is past the 200 that level 2 needs.
    expect(await xpOf(a.id)).toEqual({ xp: '280', level: 2 });
    expect(await wallet(a)).toEqual({ coins: 160, gems: 0 });
    expect((await history(a)).items.map((e) => [e.reason, e.amount, e.ref_type, e.ref_id])).toEqual([
      ['level_up', 100, 'level', '2'],
      ['duel_win', 30, 'duel', expect.any(String)],
      ['duel_win', 30, 'duel', expect.any(String)],
    ]);
  });

  it('pays nothing for a forfeit, but the winner and the forfeiter keep what their answers earned', async () => {
    const [a, b] = [await player(), await player()];
    await befriend(t.pool, a.id, b.id);
    const res = await req(a, 'POST', '/v1/duels', { opponent: { user_id: b.id } });
    const id = (res.json() as CreateDuelResponse).duel.id;
    await playTurn(a, id, 'right');
    t.clock.advance(49 * HOUR);
    await expireDueDuels(new DuelService({ ...deps, config: t.config }));
    await wake(a, b);

    const seen = await getDuel(a, id);
    expect(seen).toMatchObject({ state: 'forfeit', result: 'win', reward: { coins: 30, xp: 80 } });
    expect((await getDuel(b, id)).reward).toEqual({ coins: 0, xp: 0 });
    expect(await wallet(b)).toEqual({ coins: 0, gems: 0 });
    expect((await history(b)).items).toEqual([]);
  });
});

describe('the ledger', () => {
  it('grants once per key, spends only what a player has, and always balances', async () => {
    const p = await player();
    const now = t.clock.now();
    const grant = () =>
      withTransaction(t.pool, (c) =>
        grantCoins(c, p.id, 50, { key: `test:${p.id}:g`, reason: 'admin_grant', now }),
      );
    const spend = (key: string) =>
      withTransaction(t.pool, (c) =>
        spendCoins(c, p.id, 30, { key: `test:${p.id}:${key}`, reason: 'lifeline', now }),
      );

    expect(await grant()).toEqual({ userId: p.id, delta: 50, reason: 'admin_grant', balance: 50 });
    expect(await grant()).toBeNull();
    expect(await spend('a')).toEqual({ userId: p.id, delta: -30, reason: 'lifeline', balance: 20 });
    // The same purchase again is no second charge.
    expect(await spend('a')).toBeNull();
    const short = await spend('b').catch((err: unknown) => err);
    expect(short).toBeInstanceOf(ApiError);
    expect(short).toMatchObject({ status: 409, code: 'NOT_ENOUGH_COINS' });
    expect(await wallet(p)).toEqual({ coins: 20, gems: 0 });
    expect((await history(p)).items.map((e) => [e.reason, e.amount])).toEqual([
      ['lifeline', -30],
      ['admin_grant', 50],
    ]);
    expect(await unbalanced()).toBe(0);
  });

  it("moves a guest's coins into the account they sign in to", async () => {
    const rest = String(randomInt(0, 10_000_000)).padStart(7, '0');
    const phone = { typed: `0803 ${rest.slice(0, 3)} ${rest.slice(3)}`, e164: `+234803${rest}` };
    const signIn = async (access?: string) => {
      const sent = await t.app.inject({
        method: 'POST',
        url: '/v1/auth/otp/send',
        headers: access ? bearer(access) : {},
        payload: { phone: phone.typed, platform: 'android' },
      });
      expect(sent.statusCode, sent.body).toBe(200);
      const res = await t.app.inject({
        method: 'POST',
        url: '/v1/auth/otp/verify',
        headers: access ? bearer(access) : {},
        payload: { request_id: sent.json().request_id, code: t.sms.codeFor(phone.e164) },
      });
      expect(res.statusCode, res.body).toBeLessThan(300);
      return res.json() as SignInResponse;
    };
    const account = await signIn();
    const guest = await player();
    const now = t.clock.now();
    await withTransaction(t.pool, async (c) => {
      await grantCoins(c, account.user.id, 15, {
        key: `test:${account.user.id}`,
        reason: 'admin_grant',
        now,
      });
      await grantCoins(c, guest.id, 40, { key: `test:${guest.id}`, reason: 'admin_grant', now });
    });

    t.clock.advance(60_000); // past the 30 s wait before a second code to the same number
    const merged = await signIn(guest.access);
    expect(merged).toMatchObject({ merged_guest: true, user: { id: account.user.id } });
    const me = { id: account.user.id, access: merged.access, deviceId: guest.deviceId };
    expect(await wallet(me)).toEqual({ coins: 55, gems: 0 });
    expect((await history(me)).items[0]).toMatchObject({
      reason: 'merge',
      amount: 40,
      ref_type: 'user',
      ref_id: guest.id,
    });
    const left = await t.pool.query('SELECT balance FROM ledger_accounts WHERE id = $1', [
      `user:${guest.id}:coins`,
    ]);
    expect(left.rows).toEqual([{ balance: '0' }]);
    expect(await unbalanced()).toBe(0);
  });

  it("checks every balance at night and raises a problem when they don't add up", async () => {
    const p = await player();
    await withTransaction(t.pool, (c) =>
      grantCoins(c, p.id, 25, { key: `test:${p.id}`, reason: 'admin_grant', now: t.clock.now() }),
    );
    // 02:00 WAT is too early; 04:30 runs, once a night.
    t.clock.t = Date.UTC(2026, 11, 1, 1, 0, 0);
    expect(await checkLedger(deps)).toBeNull();
    t.clock.t = Date.UTC(2026, 11, 1, 3, 30, 0);
    expect(await checkLedger(deps)).toEqual({ unbalanced: 0, drifted: 0 });
    expect(await checkLedger(deps)).toBeNull();

    const account = `user:${p.id}:coins`;
    await t.pool.query('UPDATE ledger_accounts SET balance = balance + 5 WHERE id = $1', [account]);
    try {
      t.clock.t = Date.UTC(2026, 11, 2, 3, 30, 0);
      expect(await checkLedger(deps)).toEqual({ unbalanced: 0, drifted: 1 });
      const alerts = await t.pool.query(
        "SELECT kind, title, body FROM staff_alerts WHERE dedupe_key = 'ledger:2026-12-02'",
      );
      expect(alerts.rows).toEqual([
        {
          kind: 'problem',
          title: "Coin balances don't add up",
          body: expect.stringMatching(
            /^1 player balance differs from the ledger and 0 transactions do not balance/,
          ),
        },
      ]);
    } finally {
      await t.pool.query('UPDATE ledger_accounts SET balance = balance - 5 WHERE id = $1', [account]);
    }
  });
});

describe('the wallet', () => {
  it('needs a player, and gives the history newest first, a page at a time', async () => {
    expect((await req(null, 'GET', '/v1/wallet')).statusCode).toBe(401);
    const p = await player();
    await wake(p);
    expect(await wallet(p)).toEqual({ coins: 0, gems: 0 });
    await withTransaction(t.pool, async (c) => {
      for (let i = 1; i <= 35; i++) {
        await grantCoins(c, p.id, i, { key: `test:${p.id}:${i}`, reason: 'admin_grant', now: t.clock.now() });
      }
    });
    const first = await history(p);
    expect(first.items.map((e) => e.amount)).toEqual(Array.from({ length: 30 }, (_, i) => 35 - i));
    expect(first.next).not.toBeNull();
    const second = await history(p, first.next!);
    expect(second.items.map((e) => e.amount)).toEqual([5, 4, 3, 2, 1]);
    expect(second.next).toBeNull();
    expect(await wallet(p)).toEqual({ coins: (35 * 36) / 2, gems: 0 });
    expect((await req(p, 'GET', '/v1/wallet/history?before=abc')).statusCode).toBe(400);
  });
});
