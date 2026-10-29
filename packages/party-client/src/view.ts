/**
 * A party room as the screens see it: the room's state from the server, the question in front
 * of this player, their answer, the reveal and leaderboard after it, and the podium. Everything
 * comes from the room's WebSocket (API §3); `partyReducer` folds its messages into one view.
 */
import type {
  PartyErrorCode,
  PartyLeaderboardMessage,
  PartyPodiumMessage,
  PartyQuestionMessage,
  PartyRevealMessage,
  PartyRoomState,
  PartyServerMessage,
} from '@whosabi/shared-types/party-protocol';
import type { PartyEnd, PartySocketStatus } from './socket';

export interface PartyView {
  status: PartySocketStatus;
  end: PartyEnd | null;
  you: { id: string; name: string; role: 'player' | 'screen' } | null;
  room: PartyRoomState | null;
  question: PartyQuestionMessage | null;
  /** When the question appeared on this screen (this device's clock), for the answer time. */
  shownAt: number;
  chosen: number | null;
  reveal: PartyRevealMessage | null;
  board: PartyLeaderboardMessage | null;
  podium: PartyPodiumMessage | null;
  toast: { id: number; kind: string; name: string } | null;
  error: { code: PartyErrorCode; message: string } | null;
}

export type PartyAction =
  | { type: 'status'; status: PartySocketStatus; end?: PartyEnd }
  | { type: 'message'; message: PartyServerMessage; at: number }
  | { type: 'chose'; index: number };

export const initialPartyView: PartyView = {
  status: 'connecting',
  end: null,
  you: null,
  room: null,
  question: null,
  shownAt: 0,
  chosen: null,
  reveal: null,
  board: null,
  podium: null,
  toast: null,
  error: null,
};

export function partyReducer(view: PartyView, action: PartyAction): PartyView {
  if (action.type === 'status') return { ...view, status: action.status, end: action.end ?? view.end };
  if (action.type === 'chose') return { ...view, chosen: action.index };
  const m = action.message;
  switch (m.type) {
    case 'welcome':
      return { ...view, you: m.you };
    case 'state': {
      const { type: _type, ...room } = m;
      // Back in the lobby (play again): the last game's screens go.
      if (room.phase === 'LOBBY')
        return { ...view, room, question: null, reveal: null, board: null, podium: null };
      return { ...view, room };
    }
    case 'question':
      // The same question again after a reconnect keeps the answer already given.
      if (view.question?.qid === m.qid) return { ...view, question: m };
      return {
        ...view,
        question: m,
        shownAt: action.at,
        chosen: null,
        reveal: null,
        board: null,
        error: null,
      };
    case 'reveal':
      return { ...view, reveal: m };
    case 'leaderboard':
      return { ...view, board: m };
    case 'podium':
      return { ...view, podium: m };
    case 'toast':
      return { ...view, toast: { id: (view.toast?.id ?? 0) + 1, kind: m.kind, name: m.name } };
    case 'error':
      return { ...view, error: { code: m.code, message: m.message } };
    default:
      return view;
  }
}
