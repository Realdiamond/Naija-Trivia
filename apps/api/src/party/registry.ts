/**
 * The party rooms this process holds (step 2.2a). A room lives in the memory of the process
 * that made it, so on Heroku party rooms need the game app on one web dyno (deploy guide);
 * codes are reserved in Redis, so they stay unique however many processes run, and a closed
 * room's code isn't given out again for 10 minutes (FR-PARTY-1).
 *
 * The rooms report into the rest of the game here: the no-repeat history, question stats and
 * calibration, analytics, and the saved results with XP.
 */
import { randomInt } from 'node:crypto';
import {
  DEFAULT_CONFIG,
  generateRoomCode,
  NEW_PLAYER_RATING,
  normaliseRoomCode,
  PARTY_TIMINGS,
  ROOM_CODE_RESERVED_MS,
  type PartyTimings,
} from '@whosabi/game-rules';
import type { PartySettings } from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import type { PartySeatClaims } from '../auth/tokens';
import { overallRating, recordQuestionStats } from '../content/stats';
import { markSeen } from '../duels/questions';
import type { EventContext } from '../events';
import { newId } from '../ids';
import { pickPartyQuestions } from './questions';
import { saveGame } from './results';
import { PartyRoom, type RoomHooks, type Scheduler, type SeatInfo } from './room';

export type PartyDeps = Pick<AppDeps, 'config' | 'pool' | 'redis' | 'clock' | 'events' | 'log'>;

/** A running room's code is held this long, and again at every game it starts. */
const CODE_HOLD_SECONDS = 12 * 3600;

const codeKey = (code: string) => `party:code:${code}`;

export class PartyRooms {
  private readonly rooms = new Map<string, PartyRoom>();
  private readonly codes = new Map<string, PartyRoom>();
  private readonly scheduler: Scheduler;

  constructor(
    private readonly deps: PartyDeps,
    private readonly timings: PartyTimings = PARTY_TIMINGS,
  ) {
    // The app's clock tells the time; real timers move the rooms along.
    this.scheduler = {
      now: () => deps.clock.now(),
      after: (ms, fn) => {
        const timer = setTimeout(fn, ms);
        timer.unref();
        return () => clearTimeout(timer);
      },
    };
  }

  /** The room with this code (as typed), if it is running here. */
  byCode(input: string): PartyRoom | null {
    const code = normaliseRoomCode(input);
    const room = code ? this.codes.get(code) : undefined;
    return room && !room.closed ? room : null;
  }

  byId(id: string): PartyRoom | null {
    const room = this.rooms.get(id);
    return room && !room.closed ? room : null;
  }

  async create(host: Omit<PartySeatClaims, 'roomId'>, settings: PartySettings): Promise<PartyRoom> {
    const { redis, clock, config } = this.deps;
    const id = newId('pr', clock.now());
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateRoomCode(randomInt);
      if ((await redis.set(codeKey(code), id, 'EX', CODE_HOLD_SECONDS, 'NX')) !== 'OK') continue;
      const room = new PartyRoom({
        id,
        code,
        host: { ...host, roomId: id },
        settings,
        maxPlayers: DEFAULT_CONFIG['party.max_players_free'],
        timings: this.timings,
        defaultRttMs: config.defaultRttMs,
        publicWebUrl: config.publicWebUrl,
        newGameId: () => newId('pg', clock.now()),
        scheduler: this.scheduler,
        hooks: this.hooks(),
        log: this.deps.log,
      });
      this.rooms.set(id, room);
      this.codes.set(code, room);
      return room;
    }
    throw new Error('no free party room code after 10 tries');
  }

  /** Shutting down: everyone is told the room closed, rather than left hanging. */
  closeAll(): void {
    for (const room of [...this.rooms.values()]) room.close();
  }

  private hooks(): RoomHooks {
    const { pool, redis, clock, events, log } = this.deps;
    const ctx = (seat: SeatInfo, userId: string): EventContext => ({ userId, platform: seat.platform });
    const background = (what: string, work: Promise<unknown>) =>
      void work.catch((err: unknown) => log.warn({ err }, `party: ${what} failed`));

    return {
      pickQuestions: (settings, userIds) => pickPartyQuestions(pool, settings, userIds, clock.now()),
      questionShown: (q, userIds) =>
        background(
          'no-repeat history',
          Promise.all(userIds.map((id) => markSeen(pool, id, q.id, clock.now()))),
        ),
      answered: (a) =>
        background(
          'answer stats',
          (async () => {
            const playerRating = a.seat.userId
              ? await overallRating(pool, a.seat.userId)
              : NEW_PLAYER_RATING.rating;
            await recordQuestionStats(
              redis,
              log,
              a.q.id,
              { correct: a.correct, acceptedMs: a.acceptedMs, canonicalIndex: a.chosenIndex },
              { itemRating: a.q.d_rating, playerRating },
            );
            if (!a.seat.userId) return;
            await events.emit(
              'question_answered',
              {
                qid: a.q.id,
                category: a.q.category_id,
                difficulty: a.q.difficulty,
                correct: a.correct,
                timed_out: a.timedOut,
                accepted_elapsed_ms: a.acceptedMs,
                points: a.points,
                mode: 'party',
                lifeline: null,
              },
              ctx(a.seat, a.seat.userId),
            );
          })(),
        ),
      joined: (seat, players) => {
        if (!seat.userId) return;
        background(
          'join event',
          events.emit(
            'party_joined',
            { client: seat.kind === 'app' ? 'app' : 'web_app', player_count: players },
            ctx(seat, seat.userId),
          ),
        );
      },
      finished: (game) =>
        background(
          'saving the game',
          (async () => {
            const paid = await saveGame(pool, game);
            const webGuests = game.ranking.filter((p) => p.kind === 'web_guest').length;
            for (const p of game.ranking) {
              if (!p.userId) continue;
              await events.emit(
                'party_game_completed',
                { game_id: game.gameId, players: game.ranking.length, web_guests: webGuests, rank: p.rank },
                ctx(p, p.userId),
              );
            }
            for (const change of paid) {
              const p = game.ranking.find((r) => r.userId === change.userId)!;
              await events.emit(
                'coins_changed',
                { delta: change.delta, reason: change.reason, balance_after: change.balance },
                ctx(p, change.userId),
              );
            }
          })(),
        ),
      closed: (room) => {
        this.rooms.delete(room.id);
        this.codes.delete(room.code);
        background(
          'releasing the code',
          redis.set(codeKey(room.code), 'closed', 'PX', ROOM_CODE_RESERVED_MS),
        );
      },
    };
  }
}
