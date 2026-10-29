/**
 * The party room for the app's screens: the room's WebSocket (API §3) folded into one view by
 * `partyReducer` (shared with the light web party client), and the moves the screens send back.
 */
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { initialPartyView, partyReducer, PartySocket, socketUrl } from '@whosabi/party-client';
import type { PartyClientMessage, PartyQuestionMessage, PartySeat } from '@whosabi/shared-types';
import { API_URL } from '../../config';

export type { PartyView } from '@whosabi/party-client';

export function useParty(seat: PartySeat | null) {
  const [view, dispatch] = useReducer(partyReducer, initialPartyView);
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
