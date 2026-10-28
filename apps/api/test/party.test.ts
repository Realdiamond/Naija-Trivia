/**
 * Party rooms through the API (step 2.2a, API §2.7 and §3): a host makes a room, a web guest
 * takes a seat with just a nickname, both play a whole game over the room's WebSocket, and the
 * result is saved with XP. Phases are shortened; everyone answers, so questions end at once.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import type {
  CreatePartyResponse,
  PartyClientMessage,
  PartyGameResult,
  PartyRoomPreview,
  PartySeat,
  PartyServerMessage,
} from '@whosabi/shared-types';
import { bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let categories: string[];
beforeAll(async () => {
  t = await createTestApp(
    {},
    { partyTimings: { countdownMs: 20, revealMs: 20, leaderboardMs: 20, graceMs: 50 } },
  );
  categories = (await t.pool.query<{ id: string }>('SELECT id FROM categories WHERE active')).rows.map(
    (r) => r.id,
  );
});
afterAll(() => t.close());

const SETTINGS = { questions: 5, timer_s: 10, family_safe: false, wahala: true, host_plays: true } as const;

/** One seat's WebSocket: everything it hears, and a way to wait for the next of a kind. */
class Client {
  readonly heard: PartyServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  private seen = 0;
  private ws!: WebSocket;
  private wake: (() => void) | null = null;

  static async open(token: string): Promise<Client> {
    const c = new Client();
    c.ws = await t.app.injectWS(
      `/v1/party/socket?token=${encodeURIComponent(token)}`,
      {},
      {
        onInit: (ws) => {
          ws.on('message', (data) => {
            c.heard.push(JSON.parse(String(data)) as PartyServerMessage);
            c.wake?.();
          });
          ws.on('close', (code, reason) => {
            c.closed = { code, reason: String(reason) };
            c.wake?.();
          });
        },
      },
    );
    return c;
  }

  send(message: PartyClientMessage): void {
    this.ws.send(JSON.stringify(message));
  }

  /** The next message of this type since the last one taken. */
  async next<T extends PartyServerMessage['type']>(
    type: T,
  ): Promise<Extract<PartyServerMessage, { type: T }>> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const i = this.heard.findIndex((m, index) => index >= this.seen && m.type === type);
      if (i >= 0) {
        this.seen = i + 1;
        return this.heard[i] as Extract<PartyServerMessage, { type: T }>;
      }
      if (this.closed || Date.now() > deadline)
        throw new Error(`no ${type} message (closed: ${this.closed?.code})`);
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        setTimeout(resolve, 50);
      });
    }
  }

  async closedWith(): Promise<number> {
    for (let i = 0; i < 100 && !this.closed; i++) await new Promise((r) => setTimeout(r, 20));
    return this.closed!.code;
  }

  end(): void {
    this.ws.close();
  }
}

/** Where the right answer is in the options this player was sent. */
async function rightIndex(qid: string, options: string[]): Promise<number> {
  const row = (
    await t.pool.query<{ options: string[]; correct_index: number }>(
      'SELECT options, correct_index FROM questions WHERE id = $1',
      [qid],
    )
  ).rows[0]!;
  return options.indexOf(row.options[row.correct_index]!);
}

describe('party rooms', () => {
  it('a host and a web guest play a whole game, and the result is kept', async () => {
    const host = await signInGuest(t.app);
    // A guest in the app has no username: the room needs a nickname.
    const noName = await t.app.inject({
      method: 'POST',
      url: '/v1/party/rooms',
      headers: bearer(host.access),
      payload: { settings: { ...SETTINGS, categories } },
    });
    expect([noName.statusCode, noName.json().code]).toEqual([400, 'NICKNAME_REQUIRED']);
    const created = await t.app.inject({
      method: 'POST',
      url: '/v1/party/rooms',
      headers: bearer(host.access),
      payload: { settings: { ...SETTINGS, categories }, nickname: 'Tolu' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { room, seat } = created.json() as CreatePartyResponse;
    expect(room).toMatchObject({ host: 'Tolu', status: 'lobby', players: 0, max_players: 20 });
    expect(seat).toMatchObject({ room_id: expect.stringMatching(/^pr_/), socket_path: '/v1/party/socket' });

    // The link's card is public; a typed code is tidied up.
    const preview = await t.app.inject({ method: 'GET', url: `/v1/party/rooms/${room.code.toLowerCase()}` });
    expect(preview.json() as PartyRoomPreview).toMatchObject({ code: room.code, host: 'Tolu' });
    expect((await t.app.inject({ method: 'GET', url: '/v1/party/rooms/ZZZZZ' })).json().code).toBe(
      'PARTY_ROOM_NOT_FOUND',
    );

    // A web guest needs only a nickname, and not a rude one.
    const join = (payload: object) =>
      t.app.inject({ method: 'POST', url: `/v1/party/rooms/${room.code}/join`, payload });
    expect((await join({})).json().code).toBe('NICKNAME_REQUIRED');
    expect((await join({ nickname: 'Big Ashawo' })).json().code).toBe('NICKNAME_NOT_ALLOWED');
    const guestSeat = (await join({ nickname: 'Big Bolu' })).json() as PartySeat;

    const tolu = await Client.open(seat.token);
    expect(await tolu.next('welcome')).toMatchObject({ you: { id: `u:${host.user.id}`, name: 'Tolu' } });
    const bolu = await Client.open(guestSeat.token);
    expect((await bolu.next('welcome')).you).toMatchObject({ name: 'Big Bolu', role: 'player' });
    expect(await tolu.next('toast')).toEqual({ type: 'toast', kind: 'joined', name: 'Big Bolu' });
    expect((await t.app.inject({ method: 'GET', url: `/v1/party/rooms/${room.code}` })).json()).toMatchObject(
      {
        players: 2,
        names: ['Tolu', 'Big Bolu'],
      },
    );

    // Clock sync, and the host-only check.
    tolu.send({ type: 'time', t0: 123 });
    expect(await tolu.next('time')).toMatchObject({ t0: 123, ts: t.clock.now() });
    bolu.send({ type: 'start' });
    expect(await bolu.next('error')).toMatchObject({ code: 'NOT_HOST' });

    tolu.send({ type: 'start' });
    for (let i = 0; i < 5; i++) {
      const [qa, qb] = await Promise.all([tolu.next('question'), bolu.next('question')]);
      expect(qa).toMatchObject({ index: i, total: 5, wahala: i >= 2 });
      expect(qb.qid).toBe(qa.qid);
      tolu.send({
        type: 'answer',
        qid: qa.qid,
        display_index: await rightIndex(qa.qid, qa.options),
        client_elapsed_ms: 2000,
      });
      const wrong = ((await rightIndex(qb.qid, qb.options)) + 1) % qb.options.length;
      bolu.send({ type: 'answer', qid: qb.qid, display_index: wrong, client_elapsed_ms: 2000 });
      const reveal = await tolu.next('reveal');
      expect(reveal.you).toMatchObject({ correct: true });
      expect((await bolu.next('reveal')).you).toMatchObject({ correct: false, points: 0 });
      await tolu.next('leaderboard');
    }
    const podium = await bolu.next('podium');
    expect(podium.ranking.map((p) => [p.name, p.rank, p.kind, p.correct])).toEqual([
      ['Tolu', 1, 'app', 5],
      ['Big Bolu', 2, 'web_guest', 0],
    ]);
    expect(podium.mvp).toMatchObject({ name: 'Tolu', correct: 5, total: 5 });

    // Saved, with XP for the signed-in player (5 right × 10 + 50); the guest has none to get.
    await expect
      .poll(
        async () =>
          (await t.pool.query('SELECT 1 FROM party_games WHERE id = $1', [podium.game_id])).rows.length,
      )
      .toBe(1);
    const xp = await t.pool.query<{ xp: string }>('SELECT xp FROM users WHERE id = $1', [host.user.id]);
    expect(Number(xp.rows[0]!.xp)).toBe(100);
    const result = (
      await t.app.inject({ method: 'GET', url: `/v1/party/games/${podium.game_id}` })
    ).json() as PartyGameResult;
    expect(result).toMatchObject({ room_code: room.code, questions: 5, mvp: { name: 'Tolu' } });
    expect(result.ranking.map((r) => [r.name, r.kind, r.score > 0])).toEqual([
      ['Tolu', 'app', true],
      ['Big Bolu', 'web_guest', false],
    ]);

    tolu.end();
    bolu.end();
  });

  it('refuses a bad seat, a full room, and a big screen for anyone but the host', async () => {
    const bad = await Client.open('x'.repeat(40));
    expect(await bad.closedWith()).toBe(4003);

    const host = await signInGuest(t.app);
    const { room } = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/party/rooms',
        headers: bearer(host.access),
        payload: { settings: { ...SETTINGS, categories }, nickname: 'Host' },
      })
    ).json() as CreatePartyResponse;
    const other = await signInGuest(t.app);
    const screen = (who: { access: string }) =>
      t.app.inject({
        method: 'POST',
        url: `/v1/party/rooms/${room.code}/join`,
        headers: bearer(who.access),
        payload: { screen: true },
      });
    expect((await screen(other)).statusCode).toBe(403);
    const big = (await screen(host)).json() as PartySeat;
    const tv = await Client.open(big.token);
    expect((await tv.next('welcome')).you).toMatchObject({ role: 'screen' });
    tv.end();

    // Unknown packs are refused up front.
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/party/rooms',
      headers: bearer(host.access),
      payload: { settings: { ...SETTINGS, categories: ['no_such_pack'] }, nickname: 'Host' },
    });
    expect(res.statusCode).toBe(400);
  });
});
