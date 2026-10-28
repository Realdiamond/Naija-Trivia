/**
 * A party room as the screens see it: the room's state from the server, the question in front
 * of this player, their answer, the reveal and leaderboard after it, and the podium. Everything
 * comes from the room's WebSocket (API §3); the screens send moves back through `act`.
 */
import { useEffect, useMemo, useReducer, useRef } from 'react';
import type {
  PartyClientMessage,
  PartyErrorCode,
  PartyLeaderboardMessage,
  PartyPodiumMessage,
  PartyQuestionMessage,
  PartyRevealMessage,
  PartyRoomState,
  PartySeat,
  PartyServerMessage,
} from '@whosabi/shared-types';
import { API_URL } from '../../config';
import { PartySocket, socketUrl, type PartyEnd, type PartySocketStatus } from './socket';

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

type Action =
  | { type: 'status'; status: PartySocketStatus; end?: PartyEnd }
  | { type: 'message'; message: PartyServerMessage; at: number }
  | { type: 'chose'; index: number };

const initial: PartyView = {
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

export function partyReducer(view: PartyView, action: Action): PartyView {
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

export function useParty(seat: PartySeat | null) {
  const [view, dispatch] = useReducer(partyReducer, initial);
  const socket = useRef<PartySocket | null>(null);

  useEffect(() => {
    if (!seat) return;
    const here = typeof window !== 'undefined' ? window.location?.origin : undefined;
    const s = new PartySocket(socketUrl(API_URL, seat.socket_path, seat.token, here), {
      message: (message) => dispatch({ type: 'message', message, at: Date.now() }),
      status: (status, end) => dispatch({ type: 'status', status, end }),
    });
    socket.current = s;
    s.connect();
    return () => {
      s.close();
      socket.current = null;
    };
  }, [seat]);

  const act = useMemo(
    () => ({
      send: (message: PartyClientMessage) => socket.current?.send(message),
      answer: (question: PartyQuestionMessage, index: number, shownAt: number) => {
        dispatch({ type: 'chose', index });
        socket.current?.send({
          type: 'answer',
          qid: question.qid,
          display_index: index,
          client_elapsed_ms: Math.max(0, Math.round(Date.now() - shownAt)),
        });
      },
      leave: () => {
        socket.current?.send({ type: 'leave' });
        socket.current?.close();
      },
      serverNow: () => socket.current?.serverNow() ?? Date.now(),
    }),
    [],
  );

  return { view, act };
}
