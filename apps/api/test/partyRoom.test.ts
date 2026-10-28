/**
 * The party room engine (step 2.2a, GDD §2.2, TRD §4.4, API §3) on its own: a clock moved by
 * hand and connections that only record what they hear.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  optionPermutation,
  PARTY_TIMINGS,
  scoreAnswer,
  shuffleSeed,
  toDisplayIndex,
} from '@whosabi/game-rules';
import type { PartyServerMessage, PartySettings } from '@whosabi/shared-types';
import type { PartySeatClaims } from '../src/auth/tokens';
import { PartyRoom, type FinishedGame, type PartyQuestion, type Scheduler } from '../src/party/room';

class ManualClock implements Scheduler {
  t = 1_800_000_000_000;
  private timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  now = () => this.t;
  after(ms: number, fn: () => void) {
    const timer = { at: this.t + ms, fn, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }
  /** Moves time on, running each timer that falls due in order. */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => !x.cancelled && x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.cancelled = true;
      this.t = due.at;
      due.fn();
    }
    this.t = end;
  }
}

interface FakeConn {
  sent: PartyServerMessage[];
  closed: { code: number; reason: string } | null;
  send(m: PartyServerMessage): void;
  close(code: number, reason: string): void;
}

function conn(): FakeConn {
  const c: FakeConn = {
    sent: [],
    closed: null,
    send(m) {
      if (!c.closed) c.sent.push(m);
    },
    close(code, reason) {
      c.closed = { code, reason };
    },
  };
  return c;
}

function last<T extends PartyServerMessage['type']>(c: FakeConn, type: T) {
  return c.sent.filter((m) => m.type === type).at(-1) as Extract<PartyServerMessage, { type: T }> | undefined;
}

const seat = (id: string, over: Partial<PartySeatClaims> = {}): PartySeatClaims => ({
  roomId: 'pr_test',
  seat: `u:${id}`,
  name: id,
  kind: 'app',
  role: 'player',
  userId: id,
  avatarId: null,
  platform: 'android',
  ...over,
});

const questions = (n: number): PartyQuestion[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    category_id: 'food',
    type: 'mcq4',
    text: `Question ${i}?`,
    options: ['Right', 'Wrong one', 'Wrong two', 'Wrong three'],
    correct_index: 0,
    fact: `Fact ${i}`,
    difficulty: 3,
    d_rating: 1500,
  }));

const SETTINGS: PartySettings = {
  questions: 5,
  timer_s: 10,
  categories: ['food'],
  family_safe: true,
  wahala: true,
  host_plays: true,
};

let clock: ManualClock;
let available: PartyQuestion[];
let finished: FinishedGame[];
let closedRooms: number;
let answers: Array<{ seat: string; correct: boolean; points: number }>;

function room(settings: Partial<PartySettings> = {}, host = seat('tolu')) {
  return new PartyRoom({
    id: 'pr_test',
    code: 'K7QXM',
    host,
    settings: { ...SETTINGS, ...settings },
    maxPlayers: 20,
    timings: PARTY_TIMINGS,
    defaultRttMs: 200,
    publicWebUrl: 'https://whosabi.ng',
    newGameId: () => 'pg_game',
    scheduler: clock,
    hooks: {
      pickQuestions: async (s) => available.slice(0, s.questions),
      questionShown: () => undefined,
      answered: (a) => answers.push({ seat: a.seat.id, correct: a.correct, points: a.points }),
      joined: () => undefined,
      finished: (g) => finished.push(g),
      closed: () => closedRooms++,
    },
    log: { warn: () => undefined },
  });
}

beforeEach(() => {
  clock = new ManualClock();
  available = questions(20);
  finished = [];
  closedRooms = 0;
  answers = [];
});

/** Where the right answer ("Right", option 0) is for this seat. */
const rightFor = (seatId: string, qid: string) =>
  toDisplayIndex(optionPermutation(4, shuffleSeed('pg_game', seatId, qid)), 0);

/** Lets the questions arrive (the room picks them asynchronously). */
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function started(r: PartyRoom, host: string) {
  r.handle(host, { type: 'start' });
  await settle();
  clock.advance(PARTY_TIMINGS.countdownMs);
}

describe('a party game', () => {
  it('runs from the lobby to the podium, with the Wahala Round worth double', async () => {
    const r = room();
    const [host, ada, bola] = [conn(), conn(), conn()];
    r.join(seat('tolu'), host);
    r.join(seat('ada'), ada);
    expect(last(host, 'toast')).toEqual({ type: 'toast', kind: 'joined', name: 'ada' });
    r.join(seat('bola'), bola);
    expect(last(host, 'state')!.players.map((p) => p.name)).toEqual(['tolu', 'ada', 'bola']);

    // Only the host starts it.
    r.handle('u:ada', { type: 'start' });
    expect(last(ada, 'error')).toMatchObject({ code: 'NOT_HOST' });
    r.handle('u:tolu', { type: 'start' });
    await settle();
    expect(last(host, 'state')).toMatchObject({ phase: 'COUNTDOWN', ends_at: clock.t + 3000 });
    clock.advance(3000);

    for (let i = 0; i < 5; i++) {
      const q = last(ada, 'question')!;
      expect(q).toMatchObject({ index: i, total: 5, qid: `q${i}`, wahala: i >= 2, time_limit_ms: 10_000 });
      // Everyone gets their own order of the same options.
      expect([...q.options].sort()).toEqual([...available[0]!.options].sort());
      clock.advance(2000);
      r.handle('u:tolu', {
        type: 'answer',
        qid: q.qid,
        display_index: rightFor('u:tolu', q.qid),
        client_elapsed_ms: 2000,
      });
      expect(last(host, 'answered_ack')).toEqual({ type: 'answered_ack', qid: q.qid });
      expect(last(ada, 'state')!.players.find((p) => p.id === 'u:tolu')!.answered).toBe(true);
      r.handle('u:ada', {
        type: 'answer',
        qid: q.qid,
        display_index: (rightFor('u:ada', q.qid) + 1) % 4,
        client_elapsed_ms: 2000,
      });
      // Bola doesn't answer the first question; once everyone has, the question ends.
      if (i > 0) {
        r.handle('u:bola', {
          type: 'answer',
          qid: q.qid,
          display_index: rightFor('u:bola', q.qid),
          client_elapsed_ms: 5000,
        });
      } else {
        expect(last(host, 'state')!.phase).toBe('QUESTION');
        // The clock runs out (with its 300 ms grace) 10.3 s after the question went out.
        clock.advance(10_300 - 2000);
      }
      const reveal = last(ada, 'reveal')!;
      expect(reveal).toMatchObject({
        qid: q.qid,
        correct_display_index: rightFor('u:ada', q.qid),
        you: { correct: false, points: 0 },
        fact: `Fact ${i}`,
      });
      expect(reveal.distribution.reduce((a, b) => a + b, 0)).toBe(i === 0 ? 2 : 3);
      expect(reveal.distribution[rightFor('u:ada', q.qid)]).toBe(i === 0 ? 1 : 2);
      // Tolu's points: right, at 2 s of 10, on a growing streak, doubled in the Wahala Round.
      const tolu = last(host, 'reveal')!.you!;
      const expected = scoreAnswer({
        correct: true,
        elapsedMs: 2000,
        timeLimitMs: 10_000,
        streakBefore: i,
        wahala: i >= 2,
      });
      expect(tolu).toMatchObject({ correct: true, points: expected.points, streak: i + 1 });
      clock.advance(PARTY_TIMINGS.revealMs);
      const board = last(bola, 'leaderboard')!;
      expect(board.top[0]).toMatchObject({ id: 'u:tolu', rank: 1 });
      expect(board.next).toBe(i === 4 ? 'podium' : i === 3 ? 'last' : i === 1 ? 'wahala' : 'question');
      clock.advance(PARTY_TIMINGS.leaderboardMs);
    }

    const podium = last(ada, 'podium')!;
    expect(podium.ranking.map((p) => [p.name, p.rank, p.correct])).toEqual([
      ['tolu', 1, 5],
      ['bola', 2, 4],
      ['ada', 3, 0],
    ]);
    expect(podium.mvp).toEqual({ id: 'u:tolu', name: 'tolu', correct: 5, total: 5, fastest_ms: 2000 });
    expect(podium.share_url).toBe('https://whosabi.ng/r/K7QXM');
    expect(finished).toHaveLength(1);
    expect(finished[0]!.ranking.map((p) => [p.id, p.answered])).toEqual([
      ['u:tolu', 5],
      ['u:bola', 4],
      ['u:ada', 5],
    ]);
    expect(answers.filter((a) => a.seat === 'u:ada').every((a) => !a.correct)).toBe(true);

    // Play again: the same people, scores back to zero.
    r.handle('u:tolu', { type: 'play_again' });
    expect(last(bola, 'state')).toMatchObject({ phase: 'LOBBY', q_index: -1 });
    expect(last(bola, 'state')!.players.every((p) => p.score === 0)).toBe(true);
  });

  it('needs two players and enough questions to start', async () => {
    const r = room();
    const host = conn();
    r.join(seat('tolu'), host);
    r.handle('u:tolu', { type: 'start' });
    expect(last(host, 'error')).toMatchObject({ code: 'TOO_FEW_PLAYERS' });
    r.join(seat('ada'), conn());
    available = questions(3);
    r.handle('u:tolu', { type: 'start' });
    await settle();
    expect(last(host, 'error')).toMatchObject({
      code: 'NO_QUESTIONS',
      message: 'These packs have 3 questions ready. Pick more packs or fewer questions.',
    });
    expect(last(host, 'state')!.phase).toBe('LOBBY');
  });

  it('keeps a dropped player’s points and question; a newcomer waits for the next question', async () => {
    const r = room({ wahala: false });
    const host = conn();
    const ada = conn();
    r.join(seat('tolu'), host);
    r.join(seat('ada'), ada);
    await started(r, 'u:tolu');
    const q = last(ada, 'question')!;
    clock.advance(1000);
    r.disconnect('u:ada', ada);
    expect(last(host, 'state')!.players.find((p) => p.id === 'u:ada')!.connected).toBe(false);

    // Back 3 s later: the same question, timed from when it was first sent.
    clock.advance(3000);
    const again = conn();
    r.join(seat('ada'), again);
    expect(last(again, 'question')!.qid).toBe(q.qid);
    const late = conn();
    r.join(seat('chidi'), late);
    expect(last(late, 'question')).toBeUndefined();
    r.handle('u:ada', {
      type: 'answer',
      qid: q.qid,
      display_index: rightFor('u:ada', q.qid),
      client_elapsed_ms: 900,
    });
    r.handle('u:tolu', { type: 'answer', qid: q.qid, display_index: 0, client_elapsed_ms: 900 });
    // Chidi wasn't in this question, so it ends with the two answers.
    expect(last(again, 'reveal')!.you).toMatchObject({ correct: true });
    // Timed on the server from the first send: 4 s, less the round trip and slack, not the 0.9 s claimed.
    expect(answers.find((a) => a.seat === 'u:ada')!.points).toBe(
      scoreAnswer({ correct: true, elapsedMs: 3550, timeLimitMs: 10_000, streakBefore: 0 }).points,
    );
    clock.advance(PARTY_TIMINGS.revealMs + PARTY_TIMINGS.leaderboardMs);
    expect(last(late, 'question')!.index).toBe(1);
  });

  it('hands the room over when the host is gone a minute, and lets go of players who left the lobby', () => {
    const r = room();
    const [host, ada, bola] = [conn(), conn(), conn()];
    r.join(seat('tolu'), host);
    clock.advance(10);
    r.join(seat('ada'), ada);
    clock.advance(10);
    r.join(seat('bola'), bola);
    r.disconnect('u:bola', bola);
    r.disconnect('u:tolu', host);
    clock.advance(59_000);
    expect(last(ada, 'state')!.players).toHaveLength(3);
    clock.advance(1_000);
    const toasts = ada.sent.flatMap((m) => (m.type === 'toast' ? [`${m.kind} ${m.name}`] : []));
    expect(toasts).toEqual(['joined bola', 'left bola', 'host_changed ada', 'left tolu']);
    const state = last(ada, 'state')!;
    expect(state.host_id).toBe('u:ada');
    expect(state.players.map((p) => p.id)).toEqual(['u:ada']);
  });

  it('lets the host kick, lock and fill the room, and gives a repeated name a number', () => {
    const r = room();
    const host = conn();
    r.join(seat('tolu'), host);
    const ada = conn();
    r.join(seat('ada'), ada);
    r.handle('u:tolu', { type: 'kick', player_id: 'u:ada' });
    expect(ada.closed).toEqual({ code: 4001, reason: 'The host removed you from this room' });
    const back = conn();
    r.join(seat('ada'), back);
    expect(back.closed?.code).toBe(4001);

    r.handle('u:tolu', { type: 'lock', locked: true });
    const locked = conn();
    r.join(seat('bola'), locked);
    expect(locked.closed?.code).toBe(4004);
    r.handle('u:tolu', { type: 'lock', locked: false });

    const twin = conn();
    r.join(seat('tolu2', { name: 'tolu', seat: 'g:abc', userId: null, kind: 'web_guest' }), twin);
    expect(last(twin, 'welcome')!.you.name).toBe('tolu 2');
    for (let i = 0; i < 18; i++) r.join(seat(`p${i}`), conn());
    const extra = conn();
    r.join(seat('extra'), extra);
    expect(extra.closed?.code).toBe(4004);
    expect(r.preview()).toMatchObject({ players: 20, max_players: 20, status: 'lobby' });
  });

  it('in host screen mode, shows the host the questions as written, and leaves them out of the scores', async () => {
    const r = room({ host_plays: false });
    const host = conn();
    const [ada, bola] = [conn(), conn()];
    r.join(seat('tolu'), host);
    r.join(seat('ada'), ada);
    r.handle('u:tolu', { type: 'start' });
    await settle();
    expect(last(host, 'error')).toMatchObject({ code: 'TOO_FEW_PLAYERS' });
    r.join(seat('bola'), bola);
    await started(r, 'u:tolu');
    expect(last(host, 'question')!.options).toEqual(available[0]!.options);
    expect(last(host, 'state')!.players.map((p) => p.id)).toEqual(['u:ada', 'u:bola']);
    clock.advance(10_300);
    expect(last(host, 'reveal')).toMatchObject({ correct_display_index: 0, you: null });
  });

  it('closes after 10 quiet minutes in the lobby', () => {
    const r = room();
    const host = conn();
    r.join(seat('tolu'), host);
    clock.advance(9 * 60_000);
    r.handle('u:tolu', { type: 'lock', locked: false });
    clock.advance(9 * 60_000);
    expect(r.closed).toBe(false);
    clock.advance(60_000);
    expect(r.closed).toBe(true);
    expect(host.closed?.code).toBe(4000);
    expect(closedRooms).toBe(1);
  });
});
