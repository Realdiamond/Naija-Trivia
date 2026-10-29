/**
 * Party rooms' plain types and constants (API §2.7 and §3), with no runtime dependencies, so the
 * light web party client can import them without the validation library:
 * `@whosabi/shared-types/party-protocol`. The schemas the API checks requests with are in party.ts.
 */
import type { PartySettings } from './party';

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
  /** The room's link to share: whosabi.ng/r/{CODE}. */
  link: string;
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
  /** The room's link to share: whosabi.ng/r/{CODE}. */
  link: string;
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
