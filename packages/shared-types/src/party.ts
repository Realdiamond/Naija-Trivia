/**
 * Party rooms (GDD §2.2, TRD §4.4, API §2.7 and §3): the REST side that makes rooms and seats,
 * and the messages on the room's WebSocket. Everyone sees the same question at the same moment;
 * the server keeps the clock, and each player gets the options in their own order.
 */
import { z } from 'zod';

export const PartySettings = z
  .object({
    questions: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
    timer_s: z.union([z.literal(10), z.literal(15), z.literal(20)]),
    /** The packs to ask from (category ids). */
    categories: z.array(z.string().min(1).max(40)).min(1).max(12),
    family_safe: z.boolean(),
    /** The last 3 questions harder and worth double. */
    wahala: z.boolean(),
    /** False is host screen mode: the host's screen shows the questions, and the host doesn't play. */
    host_plays: z.boolean(),
  })
  .strict();
export type PartySettings = z.infer<typeof PartySettings>;

/** A name for the room: 2–20 characters, letters, numbers, spaces and a little punctuation. */
export const PartyNickname = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u, 'use letters, numbers and spaces');

export const CreatePartyRequest = z
  .object({
    settings: PartySettings,
    /** For a player with no username yet (a guest). */
    nickname: PartyNickname.optional(),
  })
  .strict();
export type CreatePartyRequest = z.infer<typeof CreatePartyRequest>;

export const JoinPartyRequest = z
  .object({
    /** Needed without an account, or a guest in the app with no username. */
    nickname: PartyNickname.optional(),
    /** A big screen (a TV) the host opens: it shows the game and doesn't play. Host only. */
    screen: z.literal(true).optional(),
  })
  .strict();
export type JoinPartyRequest = z.infer<typeof JoinPartyRequest>;

/** A seat in a room: connect to `socket_path` with `?token=`. The token also reconnects. */
export interface PartySeat {
  room_id: string;
  code: string;
  token: string;
  socket_path: string;
  expires_at: string;
}

export type PartyPhase = 'LOBBY' | 'COUNTDOWN' | 'QUESTION' | 'REVEAL' | 'LEADERBOARD' | 'PODIUM' | 'CLOSED';

/** How a player joined: the app, the web app signed in, or the web with just a nickname. */
export type PartySeatKind = 'app' | 'web' | 'web_guest';

/** The public card for a room link ("You're joining ToluSabi's party · 7 people are in the lobby"). */
export interface PartyRoomPreview {
  code: string;
  host: string;
  /** Still in the lobby, or already playing (late joiners come in at the next question). */
  status: 'lobby' | 'playing' | 'podium';
  players: number;
  max_players: number;
  /** The first few names, for the avatars row. */
  names: string[];
  locked: boolean;
  settings: Pick<PartySettings, 'questions' | 'timer_s' | 'wahala'>;
}

export interface CreatePartyResponse {
  room: PartyRoomPreview;
  seat: PartySeat;
}

export interface PartyGameResult {
  game_id: string;
  room_code: string;
  ended_at: string;
  questions: number;
  ranking: Array<{ rank: number; name: string; kind: PartySeatKind; score: number; correct: number }>;
  mvp: PartyMvp | null;
}

export interface PartyMvp {
  id: string;
  name: string;
  correct: number;
  total: number;
  fastest_ms: number;
}

// ----- The room's WebSocket (API §3). Every message is JSON with a `type`. -----

/** Client → server. */
export const PartyClientMessage = z.discriminatedUnion('type', [
  /** Clock sync: the reply carries the server time. */
  z.object({ type: z.literal('time'), t0: z.number() }),
  z.object({ type: z.literal('settings'), settings: PartySettings }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('kick'), player_id: z.string().min(1).max(80) }),
  z.object({ type: z.literal('lock'), locked: z.boolean() }),
  z.object({
    type: z.literal('answer'),
    qid: z.string().min(1).max(80),
    display_index: z.number().int().min(0).max(15),
    client_elapsed_ms: z.number().int().min(0).max(120_000).nullable(),
  }),
  z.object({ type: z.literal('play_again') }),
  z.object({ type: z.literal('leave') }),
]);
export type PartyClientMessage = z.infer<typeof PartyClientMessage>;

export interface PartyPlayer {
  id: string;
  name: string;
  kind: PartySeatKind;
  avatar_id: string | null;
  score: number;
  connected: boolean;
  /** Answered the current question. */
  answered: boolean;
}

export interface PartyRoomState {
  room_id: string;
  code: string;
  phase: PartyPhase;
  host_id: string;
  settings: PartySettings;
  locked: boolean;
  max_players: number;
  /** From 0; -1 before the first question. */
  q_index: number;
  q_total: number;
  /** When the current phase ends, in server time (epoch ms); 0 when it waits for the host. */
  ends_at: number;
  players: PartyPlayer[];
}

export interface PartyQuestionMessage {
  type: 'question';
  index: number;
  total: number;
  qid: string;
  category_id: string;
  text: string;
  /** In this player's order (the screen gets them as written). */
  options: string[];
  time_limit_ms: number;
  ends_at: number;
  wahala: boolean;
}

export interface PartyRevealMessage {
  type: 'reveal';
  qid: string;
  correct_display_index: number;
  /** How many picked each option, in this player's order. */
  distribution: number[];
  /** Null for the screen and a host who isn't playing. */
  you: { display_index: number | null; correct: boolean; points: number; streak: number } | null;
  fact: string | null;
}

export interface PartyLeaderboardEntry {
  id: string;
  name: string;
  score: number;
  rank: number;
  /** Places moved since the last question: up is positive. */
  move: number;
}

export interface PartyLeaderboardMessage {
  type: 'leaderboard';
  top: PartyLeaderboardEntry[];
  you: { rank: number; score: number } | null;
  /** The next question is the last one, or the game is over after this. */
  next: 'question' | 'wahala' | 'last' | 'podium';
}

export interface PartyPodiumMessage {
  type: 'podium';
  game_id: string;
  ranking: Array<{
    rank: number;
    id: string;
    name: string;
    kind: PartySeatKind;
    avatar_id: string | null;
    score: number;
    correct: number;
  }>;
  mvp: PartyMvp | null;
  share_url: string;
}

/** Server → client. */
export type PartyServerMessage =
  | {
      type: 'welcome';
      you: { id: string; name: string; role: 'player' | 'screen' };
      server_time: number;
    }
  | ({ type: 'state' } & PartyRoomState)
  | { type: 'time'; t0: number; ts: number }
  | PartyQuestionMessage
  | { type: 'answered_ack'; qid: string }
  | PartyRevealMessage
  | PartyLeaderboardMessage
  | PartyPodiumMessage
  | { type: 'toast'; kind: 'joined' | 'left' | 'host_changed' | 'kicked'; name: string }
  | { type: 'error'; code: PartyErrorCode; message: string };

export type PartyErrorCode =
  'NOT_HOST' | 'NOT_NOW' | 'TOO_FEW_PLAYERS' | 'NO_QUESTIONS' | 'BAD_MESSAGE' | 'ALREADY_ANSWERED';

/** WebSocket close codes (API §3.5). */
export const PartyCloseCode = {
  /** The room closed, or the game is over and the room with it. */
  closed: 4000,
  kicked: 4001,
  /** The same seat connected somewhere else. */
  replaced: 4002,
  authFailed: 4003,
  /** Full, or locked by the host. */
  full: 4004,
} as const;
