/**
 * One party room (GDD §2.2, TRD §4.4, API §3), held in memory: the lobby, the question clock,
 * scoring, the leaderboard between questions and the podium. It knows nothing about sockets:
 * the routes hand it a connection per seat, and it decides what each one hears.
 *
 * The server is the only clock. Each phase ends at `endsAt` in server time; an answer is timed
 * from when that player was sent the question, clamped by their round trip like every other
 * answer in the game (TRD §5.3). Questions and options go out as messages, never in the shared
 * state, and each player gets the options in their own order.
 */
import {
  acceptElapsed,
  displayOrder,
  estimateRtt,
  isWahala,
  liveRanks,
  optionPermutation,
  PARTY_MIN_PLAYERS,
  partyMvp,
  rankParty,
  RTT_SAMPLES,
  scoreAnswer,
  shuffleSeed,
  toCanonicalIndex,
  toDisplayIndex,
  type PartyPhase,
  type PartyTimings,
} from '@whosabi/game-rules';
import {
  PartyCloseCode,
  type PartyClientMessage,
  type PartyErrorCode,
  type PartyLeaderboardMessage,
  type PartyMvp,
  type PartyPodiumMessage,
  type PartyRoomPreview,
  type PartyRoomState,
  type PartySeatKind,
  type PartyServerMessage,
  type PartySettings,
  type Platform,
  type QuestionType,
} from '@whosabi/shared-types';
import type { PartySeatClaims } from '../auth/tokens';

export interface Connection {
  send(message: PartyServerMessage): void;
  close(code: number, reason: string): void;
}

export interface Scheduler {
  now(): number;
  /** Runs `fn` after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export interface PartyQuestion {
  id: string;
  category_id: string;
  type: QuestionType;
  text: string;
  options: string[];
  correct_index: number;
  fact: string | null;
  difficulty: number;
  d_rating: number;
}

/** A seat, as the room's hooks see it. */
export interface SeatInfo {
  id: string;
  userId: string | null;
  name: string;
  kind: PartySeatKind;
  platform: Platform;
}

export interface FinishedGame {
  gameId: string;
  roomCode: string;
  hostUserId: string | null;
  settings: PartySettings;
  questions: number;
  startedAt: number;
  endedAt: number;
  ranking: Array<SeatInfo & { rank: number; score: number; correct: number; answered: number }>;
  mvp: PartyMvp | null;
}

/** What the room needs from outside: questions, and where to report what happened. */
export interface RoomHooks {
  /** The game's questions, picked when the host starts; fewer than asked when the packs run dry. */
  pickQuestions(settings: PartySettings, userIds: string[]): Promise<PartyQuestion[]>;
  /** A question was shown to these signed-in players (the no-repeat history). */
  questionShown(q: PartyQuestion, userIds: string[]): void;
  /** One answer, for question stats and analytics. */
  answered(answer: {
    q: PartyQuestion;
    seat: SeatInfo;
    chosenIndex: number | null;
    correct: boolean;
    timedOut: boolean;
    acceptedMs: number;
    points: number;
    wahala: boolean;
  }): void;
  joined(seat: SeatInfo, players: number): void;
  finished(game: FinishedGame): void;
  closed(room: PartyRoom): void;
}

export interface RoomOptions {
  id: string;
  code: string;
  host: PartySeatClaims;
  settings: PartySettings;
  maxPlayers: number;
  timings: PartyTimings;
  /** Round trip assumed until a player's pings come back. */
  defaultRttMs: number;
  publicWebUrl: string;
  newGameId: () => string;
  scheduler: Scheduler;
  hooks: RoomHooks;
  log: { warn(obj: object, msg: string): void };
}

/** A big screen shows the game; a few are plenty. */
const MAX_SCREENS = 3;

interface Seat extends SeatInfo {
  role: 'player' | 'screen';
  avatarId: string | null;
  /** False for a screen, and for a host in screen mode. */
  plays: boolean;
  conn: Connection | null;
  /** Host handover goes to whoever has been here longest. */
  firstJoinedAt: number;
  gone: (() => void) | null;
  rtt: number[];
  score: number;
  streak: number;
  correct: number;
  answered: number;
  fastestCorrectMs: number | null;
  lastRank: number | null;
}

interface LiveAnswer {
  displayIndex: number;
  chosenIndex: number;
  correct: boolean;
  points: number;
  streakAfter: number;
  acceptedMs: number;
}

interface LiveQuestion {
  index: number;
  q: PartyQuestion;
  wahala: boolean;
  timeLimitMs: number;
  /** When each player in it was sent the question. */
  sentAt: Map<string, number>;
  answers: Map<string, LiveAnswer>;
}

export class PartyRoom {
  readonly id: string;
  readonly code: string;
  private settings: PartySettings;
  private phase: PartyPhase = 'LOBBY';
  private hostId: string;
  private readonly hostUserId: string | null;
  private locked = false;
  private readonly seats = new Map<string, Seat>();
  private readonly kicked = new Set<string>();
  private questions: PartyQuestion[] = [];
  private qIndex = -1;
  private endsAt = 0;
  private live: LiveQuestion | null = null;
  private gameId: string | null = null;
  private startedAt = 0;
  private starting = false;
  private podium: PartyPodiumMessage | null = null;
  private phaseTimer: (() => void) | null = null;
  private idleTimer: (() => void) | null = null;

  constructor(private readonly o: RoomOptions) {
    this.id = o.id;
    this.code = o.code;
    this.settings = o.settings;
    this.hostId = o.host.seat;
    this.hostUserId = o.host.userId;
    this.touch();
  }

  get closed(): boolean {
    return this.phase === 'CLOSED';
  }

  /** The public card for the room's link. */
  preview(): PartyRoomPreview {
    const players = this.players();
    return {
      code: this.code,
      host: this.seats.get(this.hostId)?.name ?? this.o.host.name,
      status: this.phase === 'LOBBY' ? 'lobby' : this.phase === 'PODIUM' ? 'podium' : 'playing',
      players: players.length,
      max_players: this.o.maxPlayers,
      names: players.slice(0, 5).map((s) => s.name),
      locked: this.locked,
      settings: {
        questions: this.settings.questions,
        timer_s: this.settings.timer_s,
        wahala: this.settings.wahala,
      },
    };
  }

  /** Why a new seat can't come in, or null. A seat already in the room can always come back. */
  refusal(claims: Pick<PartySeatClaims, 'seat' | 'role'>): 'kicked' | 'full' | 'closed' | null {
    if (this.closed) return 'closed';
    if (this.kicked.has(claims.seat)) return 'kicked';
    if (this.seats.has(claims.seat)) return null;
    if (claims.role === 'screen') {
      return [...this.seats.values()].filter((s) => s.role === 'screen').length >= MAX_SCREENS
        ? 'full'
        : null;
    }
    return this.locked || this.players().length >= this.o.maxPlayers ? 'full' : null;
  }

  isHostUser(userId: string): boolean {
    return this.seats.get(this.hostId)?.userId === userId || this.hostUserId === userId;
  }

  // ----- Connections -----

  join(claims: PartySeatClaims, conn: Connection): void {
    const refusal = this.refusal(claims);
    if (refusal) {
      const [code, reason] =
        refusal === 'kicked'
          ? [PartyCloseCode.kicked, 'The host removed you from this room']
          : refusal === 'full'
            ? [PartyCloseCode.full, 'This room is full or locked']
            : [PartyCloseCode.closed, 'This room has closed'];
      conn.close(code, reason);
      return;
    }
    const now = this.o.scheduler.now();
    let seat = this.seats.get(claims.seat);
    const isNew = !seat;
    if (seat) {
      // The same seat from another tab or after a drop: the newest connection wins.
      if (seat.conn && seat.conn !== conn) seat.conn.close(PartyCloseCode.replaced, 'Opened somewhere else');
      seat.gone?.();
      seat.gone = null;
      seat.conn = conn;
    } else {
      seat = {
        id: claims.seat,
        userId: claims.userId,
        name: this.uniqueName(claims.name),
        kind: claims.kind,
        platform: claims.platform,
        role: claims.role,
        avatarId: claims.avatarId,
        plays: claims.role === 'player' && (claims.seat !== this.hostId || this.settings.host_plays),
        conn,
        firstJoinedAt: now,
        gone: null,
        rtt: [],
        score: 0,
        streak: 0,
        correct: 0,
        answered: 0,
        fastestCorrectMs: null,
        lastRank: null,
      };
      this.seats.set(seat.id, seat);
    }
    this.touch();
    conn.send({ type: 'welcome', you: { id: seat.id, name: seat.name, role: seat.role }, server_time: now });
    if (isNew && seat.role === 'player') {
      this.broadcast({ type: 'toast', kind: 'joined', name: seat.name }, seat.id);
      this.o.hooks.joined(seat, this.players().length);
    }
    this.broadcastState();
    this.catchUp(seat);
  }

  /** A connection ended. In the lobby the seat goes after a minute; in a game it keeps its points. */
  disconnect(seatId: string, conn: Connection): void {
    const seat = this.seats.get(seatId);
    if (!seat || seat.conn !== conn || this.closed) return;
    seat.conn = null;
    seat.gone = this.o.scheduler.after(this.o.timings.reconnectMs, () => this.goneForGood(seat));
    this.broadcastState();
    this.touch();
  }

  /** A round trip measured on this seat's connection. */
  rttSample(seatId: string, ms: number): void {
    const seat = this.seats.get(seatId);
    if (!seat) return;
    seat.rtt = [ms, ...seat.rtt].slice(0, RTT_SAMPLES);
  }

  // ----- Messages -----

  handle(seatId: string, message: PartyClientMessage): void {
    const seat = this.seats.get(seatId);
    if (!seat || this.closed) return;
    // Clock sync isn't activity: a forgotten tab mustn't keep a room open.
    if (message.type === 'time') {
      seat.conn?.send({ type: 'time', t0: message.t0, ts: this.o.scheduler.now() });
      return;
    }
    this.touch();
    switch (message.type) {
      case 'answer':
        this.answer(seat, message);
        return;
      case 'leave':
        this.leave(seat);
        return;
    }
    if (seat.id !== this.hostId) return this.error(seat, 'NOT_HOST', 'Only the host can do that.');
    switch (message.type) {
      case 'settings':
        if (this.phase !== 'LOBBY') return this.error(seat, 'NOT_NOW', 'Change the settings in the lobby.');
        this.settings = message.settings;
        seat.plays = seat.role === 'player' && message.settings.host_plays;
        this.broadcastState();
        return;
      case 'lock':
        this.locked = message.locked;
        this.broadcastState();
        return;
      case 'kick':
        this.kick(seat, message.player_id);
        return;
      case 'start':
        void this.start(seat);
        return;
      case 'play_again':
        this.playAgain(seat);
        return;
    }
  }

  close(): void {
    if (this.closed) return;
    this.phase = 'CLOSED';
    this.phaseTimer?.();
    this.idleTimer?.();
    for (const seat of this.seats.values()) {
      seat.gone?.();
      seat.conn?.close(PartyCloseCode.closed, 'This room has closed');
      seat.conn = null;
    }
    this.o.hooks.closed(this);
  }

  // ----- The game -----

  private async start(host: Seat): Promise<void> {
    if (this.phase !== 'LOBBY' || this.starting) return this.error(host, 'NOT_NOW', 'The game has started.');
    const players = this.players().filter((s) => s.conn);
    if (players.length < PARTY_MIN_PLAYERS) {
      return this.error(host, 'TOO_FEW_PLAYERS', `You need at least ${PARTY_MIN_PLAYERS} players to start.`);
    }
    this.starting = true;
    let questions: PartyQuestion[];
    try {
      questions = await this.o.hooks.pickQuestions(this.settings, signedIn(players));
    } catch (err) {
      this.starting = false;
      this.o.log.warn({ err, room: this.code }, 'party questions could not be picked');
      return this.error(host, 'NO_QUESTIONS', 'Questions could not load. Try again.');
    }
    this.starting = false;
    if (this.closed || this.phase !== 'LOBBY') return;
    if (questions.length < this.settings.questions) {
      return this.error(
        host,
        'NO_QUESTIONS',
        `These packs have ${questions.length} questions ready. Pick more packs or fewer questions.`,
      );
    }
    this.questions = questions;
    this.qIndex = -1;
    this.gameId = this.o.newGameId();
    this.startedAt = this.o.scheduler.now();
    this.enter('COUNTDOWN', this.o.timings.countdownMs, () => this.nextQuestion());
  }

  private nextQuestion(): void {
    this.qIndex++;
    const q = this.questions[this.qIndex]!;
    const total = this.questions.length;
    const now = this.o.scheduler.now();
    const timeLimitMs = this.settings.timer_s * 1000;
    this.live = {
      index: this.qIndex,
      q,
      wahala: isWahala(this.qIndex, total, this.settings.wahala),
      timeLimitMs,
      sentAt: new Map(),
      answers: new Map(),
    };
    // The clock shows the time limit; answers still count for a moment after it (API §3.4).
    this.enter('QUESTION', timeLimitMs, () => this.closeQuestion(), timeLimitMs + this.o.timings.graceMs);
    for (const seat of this.seats.values()) this.sendQuestion(seat, now);
    this.o.hooks.questionShown(q, signedIn(this.players().filter((s) => s.conn)));
  }

  private sendQuestion(seat: Seat, now: number): void {
    const live = this.live;
    if (!live || !seat.conn) return;
    if (seat.plays && !live.sentAt.has(seat.id)) live.sentAt.set(seat.id, now);
    seat.conn.send({
      type: 'question',
      index: live.index,
      total: this.questions.length,
      qid: live.q.id,
      category_id: live.q.category_id,
      text: live.q.text,
      options: seat.plays ? displayOrder(live.q.options, this.perm(seat, live.q)) : live.q.options,
      time_limit_ms: live.timeLimitMs,
      ends_at: this.endsAt,
      wahala: live.wahala,
    });
  }

  private answer(seat: Seat, message: Extract<PartyClientMessage, { type: 'answer' }>): void {
    const live = this.live;
    if (this.phase !== 'QUESTION' || !live || live.q.id !== message.qid) return;
    const sentAt = live.sentAt.get(seat.id);
    if (!seat.plays || sentAt === undefined) return;
    if (live.answers.has(seat.id)) return this.error(seat, 'ALREADY_ANSWERED', 'You already answered.');
    const perm = this.perm(seat, live.q);
    if (message.display_index >= perm.length) return this.error(seat, 'BAD_MESSAGE', 'No such option.');

    const now = this.o.scheduler.now();
    const timing = acceptElapsed({
      clientElapsedMs: message.client_elapsed_ms,
      serverElapsedMs: Math.max(0, now - sentAt),
      rttEstMs: estimateRtt(seat.rtt) ?? this.o.defaultRttMs,
      timeLimitMs: live.timeLimitMs,
    });
    const chosenIndex = toCanonicalIndex(perm, message.display_index);
    const correct = !timing.timedOut && chosenIndex === live.q.correct_index;
    const score = scoreAnswer({
      correct,
      elapsedMs: timing.acceptedMs,
      timeLimitMs: live.timeLimitMs,
      streakBefore: seat.streak,
      wahala: live.wahala,
    });
    live.answers.set(seat.id, {
      displayIndex: message.display_index,
      chosenIndex,
      correct,
      points: score.points,
      streakAfter: score.streakAfter,
      acceptedMs: timing.acceptedMs,
    });
    seat.conn?.send({ type: 'answered_ack', qid: live.q.id });
    this.o.hooks.answered({
      q: live.q,
      seat,
      chosenIndex,
      correct,
      timedOut: timing.timedOut,
      acceptedMs: timing.acceptedMs,
      points: score.points,
      wahala: live.wahala,
    });
    // Everyone still here has answered: no need to wait for the clock.
    const waiting = [...live.sentAt.keys()].some((id) => !live.answers.has(id) && this.seats.get(id)?.conn);
    if (waiting) this.broadcastState();
    else this.closeQuestion();
  }

  private closeQuestion(): void {
    const live = this.live;
    if (!live || this.phase !== 'QUESTION') return;
    const counts = live.q.options.map(() => 0);
    for (const a of live.answers.values()) counts[a.chosenIndex]!++;
    for (const id of live.sentAt.keys()) {
      const seat = this.seats.get(id);
      if (!seat) continue;
      const a = live.answers.get(id);
      // A question missed scores 0 and ends the streak (FR-PARTY-4).
      seat.streak = a?.streakAfter ?? 0;
      if (!a) continue;
      seat.answered++;
      seat.score += a.points;
      if (a.correct) {
        seat.correct++;
        seat.fastestCorrectMs = Math.min(seat.fastestCorrectMs ?? Infinity, a.acceptedMs);
      }
    }
    this.enter('REVEAL', this.o.timings.revealMs, () => this.showLeaderboard());
    for (const seat of this.seats.values()) {
      if (!seat.conn) continue;
      const a = live.answers.get(seat.id);
      const inIt = seat.plays && live.sentAt.has(seat.id);
      const perm = seat.plays ? this.perm(seat, live.q) : live.q.options.map((_, i) => i);
      seat.conn.send({
        type: 'reveal',
        qid: live.q.id,
        correct_display_index: toDisplayIndex(perm, live.q.correct_index),
        distribution: perm.map((canonical) => counts[canonical]!),
        you: inIt
          ? {
              display_index: a?.displayIndex ?? null,
              correct: a?.correct ?? false,
              points: a?.points ?? 0,
              streak: seat.streak,
            }
          : null,
        fact: live.q.fact,
      });
    }
  }

  private showLeaderboard(): void {
    const players = this.players();
    const ranks = liveRanks(players);
    const next = this.qIndex + 1;
    const total = this.questions.length;
    const upNext: PartyLeaderboardMessage['next'] =
      next >= total
        ? 'podium'
        : next === total - 1
          ? 'last'
          : isWahala(next, total, this.settings.wahala) && !isWahala(this.qIndex, total, this.settings.wahala)
            ? 'wahala'
            : 'question';
    const top = players
      .map((s) => ({ s, rank: ranks.get(s.id)! }))
      .sort((x, y) => x.rank - y.rank || x.s.firstJoinedAt - y.s.firstJoinedAt)
      .slice(0, 5)
      .map(({ s, rank }) => ({
        id: s.id,
        name: s.name,
        score: s.score,
        rank,
        move: (s.lastRank ?? rank) - rank,
      }));
    this.enter('LEADERBOARD', this.o.timings.leaderboardMs, () =>
      next < total ? this.nextQuestion() : this.finish(),
    );
    for (const seat of this.seats.values()) {
      const rank = ranks.get(seat.id);
      seat.conn?.send({
        type: 'leaderboard',
        top,
        you: rank === undefined ? null : { rank, score: seat.score },
        next: upNext,
      });
    }
    for (const s of players) s.lastRank = ranks.get(s.id)!;
  }

  private finish(): void {
    const endedAt = this.o.scheduler.now();
    this.live = null;
    const players = this.players();
    const ranked = rankParty(players);
    const mvp = partyMvp(players);
    const total = this.questions.length;
    const podiumMvp: PartyMvp | null = mvp
      ? { id: mvp.id, name: mvp.name, correct: mvp.correct, total, fastest_ms: mvp.fastestCorrectMs! }
      : null;
    this.podium = {
      type: 'podium',
      game_id: this.gameId!,
      ranking: ranked.map((s) => ({
        rank: s.rank,
        id: s.id,
        name: s.name,
        kind: s.kind,
        avatar_id: s.avatarId,
        score: s.score,
        correct: s.correct,
      })),
      mvp: podiumMvp,
      share_url: `${this.o.publicWebUrl}/r/${this.code}`,
    };
    this.enter('PODIUM', 0);
    this.broadcast(this.podium);
    this.o.hooks.finished({
      gameId: this.gameId!,
      roomCode: this.code,
      hostUserId: this.hostUserId,
      settings: this.settings,
      questions: total,
      startedAt: this.startedAt,
      endedAt,
      ranking: ranked.map((s) => ({
        id: s.id,
        userId: s.userId,
        name: s.name,
        kind: s.kind,
        platform: s.platform,
        rank: s.rank,
        score: s.score,
        correct: s.correct,
        answered: s.answered,
      })),
      mvp: podiumMvp,
    });
  }

  private playAgain(host: Seat): void {
    if (this.phase !== 'PODIUM') return this.error(host, 'NOT_NOW', 'The game is still going.');
    for (const seat of [...this.seats.values()]) {
      if (!seat.conn) {
        seat.gone?.();
        this.seats.delete(seat.id);
        continue;
      }
      Object.assign(seat, {
        score: 0,
        streak: 0,
        correct: 0,
        answered: 0,
        fastestCorrectMs: null,
        lastRank: null,
      });
    }
    this.questions = [];
    this.qIndex = -1;
    this.gameId = null;
    this.podium = null;
    this.enter('LOBBY', 0);
  }

  // ----- People -----

  private kick(host: Seat, playerId: string): void {
    const seat = this.seats.get(playerId);
    if (!seat || seat.id === host.id) return;
    this.kicked.add(seat.id);
    seat.gone?.();
    this.seats.delete(seat.id);
    this.live?.sentAt.delete(seat.id);
    this.live?.answers.delete(seat.id);
    seat.conn?.close(PartyCloseCode.kicked, 'The host removed you from this room');
    this.broadcast({ type: 'toast', kind: 'kicked', name: seat.name });
    this.broadcastState();
  }

  private leave(seat: Seat): void {
    const conn = seat.conn;
    seat.conn = null;
    conn?.close(PartyCloseCode.closed, 'You left the room');
    this.goneForGood(seat);
  }

  /**
   * A seat that didn't come back. In the lobby it goes; in a game it stays in the results. A
   * host who is gone hands the room to whoever has been here longest (FR-PARTY-5).
   */
  private goneForGood(seat: Seat): void {
    seat.gone = null;
    if (seat.conn || this.closed) return;
    if (seat.id === this.hostId) this.handOver(seat);
    if (this.phase === 'LOBBY' || this.phase === 'PODIUM') {
      this.seats.delete(seat.id);
      if (seat.role === 'player') this.broadcast({ type: 'toast', kind: 'left', name: seat.name });
    }
    this.broadcastState();
  }

  private handOver(from: Seat): void {
    const next = [...this.seats.values()]
      .filter((s) => s.id !== from.id && s.role === 'player' && s.conn)
      .sort((a, b) => a.firstJoinedAt - b.firstJoinedAt)[0];
    if (!next) return;
    this.hostId = next.id;
    // Whoever takes over plays as before; host screen mode stays with the host who chose it.
    next.plays = true;
    this.broadcast({ type: 'toast', kind: 'host_changed', name: next.name });
  }

  // ----- Plumbing -----

  /** Seats that play, in the order they came. */
  private players(): Seat[] {
    return [...this.seats.values()].filter((s) => s.plays).sort((a, b) => a.firstJoinedAt - b.firstJoinedAt);
  }

  private enter(phase: PartyPhase, shownMs: number, then?: () => void, afterMs = shownMs): void {
    this.phaseTimer?.();
    this.phaseTimer = null;
    this.phase = phase;
    this.endsAt = then ? this.o.scheduler.now() + shownMs : 0;
    if (then) this.phaseTimer = this.o.scheduler.after(afterMs, then);
    this.broadcastState();
    this.touch();
  }

  /** What someone (re)joining mid-game needs to see now. */
  private catchUp(seat: Seat): void {
    if (this.phase === 'QUESTION' && this.live) {
      // A player who was sent this question before a drop keeps their start; one new to the
      // room joins at the next question, but can watch this one.
      const known = this.live.sentAt.has(seat.id);
      if (known || !seat.plays) this.sendQuestion(seat, this.o.scheduler.now());
    }
    if (this.phase === 'PODIUM' && this.podium) seat.conn?.send(this.podium);
  }

  private state(): PartyRoomState {
    const live = this.live;
    return {
      room_id: this.id,
      code: this.code,
      phase: this.phase,
      host_id: this.hostId,
      settings: this.settings,
      locked: this.locked,
      max_players: this.o.maxPlayers,
      q_index: this.qIndex,
      q_total: this.questions.length || this.settings.questions,
      ends_at: this.endsAt,
      players: this.players().map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        avatar_id: s.avatarId,
        score: s.score,
        connected: s.conn !== null,
        answered: this.phase === 'QUESTION' && live !== null && live.answers.has(s.id),
      })),
    };
  }

  private broadcastState(): void {
    if (this.closed) return;
    const state = this.state();
    this.broadcast({ type: 'state', ...state });
  }

  private broadcast(message: PartyServerMessage, except?: string): void {
    for (const seat of this.seats.values()) if (seat.id !== except) seat.conn?.send(message);
  }

  private error(seat: Seat, code: PartyErrorCode, message: string): void {
    seat.conn?.send({ type: 'error', code, message });
  }

  private perm(seat: Seat, q: PartyQuestion): number[] {
    return optionPermutation(q.options.length, shuffleSeed(this.gameId ?? this.id, seat.id, q.id));
  }

  private uniqueName(name: string): string {
    const taken = new Set([...this.seats.values()].map((s) => s.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const candidate = `${name.slice(0, 17)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  /** Something happened: a room in the lobby or on the podium closes after a quiet spell. */
  private touch(): void {
    this.idleTimer?.();
    this.idleTimer = this.o.scheduler.after(this.o.timings.idleCloseMs, () => {
      const idle = this.phase === 'LOBBY' || this.phase === 'PODIUM';
      const empty = ![...this.seats.values()].some((s) => s.conn);
      if (idle || empty) this.close();
      else this.touch();
    });
  }
}

function signedIn(seats: readonly Seat[]): string[] {
  return seats.flatMap((s) => (s.userId ? [s.userId] : []));
}
