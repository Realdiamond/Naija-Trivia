/**
 * A party room in the light client: the same WebSocket and screen state as the app
 * (@whosabi/party-client), drawn small. The lobby, 3-2-1, each question on the room's clock,
 * the answer with what everyone picked and the top 5, then the podium.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { PARTY_MIN_PLAYERS } from '@whosabi/game-rules';
import {
  initialPartyView,
  partyReducer,
  PartySocket,
  socketUrl,
  type PartyView,
} from '@whosabi/party-client';
import type {
  PartyClientMessage,
  PartyQuestionMessage,
  PartyRoomState,
  PartySeat,
} from '@whosabi/shared-types';
import { API_URL, forgetSeat } from './api';
import { category } from './categories';
import { colourFor, initial } from './Join';
import { PLAY_STORE, whatsapp } from './links';

const ENDINGS: Record<number, string> = {
  4000: 'This room has closed.',
  4001: 'The host removed you from this room.',
  4002: 'You opened this room somewhere else.',
  4003: 'Your seat has expired. Open the link again to rejoin.',
  4004: 'This room is full or locked.',
};

export function Room({ seat, onLeave }: { seat: PartySeat; onLeave: () => void }) {
  const [view, dispatch] = useReducer(partyReducer, initialPartyView);
  const socket = useRef<PartySocket | null>(null);

  useEffect(() => {
    const s = new PartySocket(socketUrl(API_URL, seat.socket_path, seat.token, location.origin), {
      message: (message) => dispatch({ type: 'message', message, at: Date.now() }),
      status: (status, end) => dispatch({ type: 'status', status, end }),
    });
    socket.current = s;
    s.connect();
    return () => s.close();
  }, [seat]);

  const send = (message: PartyClientMessage) => socket.current?.send(message);
  const serverNow = () => socket.current?.serverNow() ?? Date.now();
  const leave = () => {
    send({ type: 'leave' });
    socket.current?.close();
    forgetSeat(seat.code);
    onLeave();
  };

  if (view.status === 'closed') {
    const code = view.end?.code ?? 0;
    return (
      <main class="page dark center">
        <h1 data-testid="party-ended">{ENDINGS[code] ?? 'We lost the connection to the room.'}</h1>
        <a class="button accent" href="/">
          Play Who Sabi? in your browser
        </a>
        <a class="button ghost" href={PLAY_STORE}>
          Get the app
        </a>
      </main>
    );
  }
  const room = view.room;
  if (!room || !view.you) return <main class="page dark center">Connecting to the room…</main>;

  const isHost = view.you.id === room.host_id;
  const plays = room.players.some((p) => p.id === view.you!.id);
  let screen;
  switch (room.phase) {
    case 'COUNTDOWN':
      screen = <Countdown room={room} serverNow={serverNow} />;
      break;
    case 'QUESTION':
      screen = (
        <Question
          room={room}
          view={view}
          plays={plays}
          serverNow={serverNow}
          onAnswer={(q, i) => {
            dispatch({ type: 'chose', index: i });
            send({
              type: 'answer',
              qid: q.qid,
              display_index: i,
              client_elapsed_ms: Math.max(0, Math.round(Date.now() - view.shownAt)),
            });
          }}
        />
      );
      break;
    case 'REVEAL':
    case 'LEADERBOARD':
      screen = <Reveal room={room} view={view} plays={plays} />;
      break;
    case 'PODIUM':
      screen = view.podium ? (
        <Podium view={view} code={room.code} isHost={isHost} onAgain={() => send({ type: 'play_again' })} />
      ) : null;
      break;
    default:
      screen = <Lobby room={room} view={view} isHost={isHost} send={send} onLeave={leave} />;
  }
  return (
    <>
      {screen}
      {view.status === 'reconnecting' ? <div class="banner">Connection lost. Trying again…</div> : null}
      <Toast toast={view.toast} />
    </>
  );
}

function Toast({ toast }: { toast: PartyView['toast'] }) {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!toast) return;
    setShown(toast.id);
    const timer = setTimeout(() => setShown(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast || shown !== toast.id) return null;
  const words: Record<string, string> = {
    joined: 'joined',
    left: 'left',
    host_changed: 'is the host now',
    kicked: 'was removed',
  };
  return (
    <div class="toast" role="status">
      {toast.name} {words[toast.kind] ?? ''}
    </div>
  );
}

/** Milliseconds left until `endsAt` on the server's clock. */
function useTimeLeft(endsAt: number, serverNow: () => number): number {
  const clock = useRef(serverNow);
  clock.current = serverNow;
  const [left, setLeft] = useState(() => Math.max(0, endsAt - serverNow()));
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, endsAt - clock.current()));
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [endsAt]);
  return endsAt === 0 ? 0 : left;
}

function Avatar({ name }: { name: string }) {
  return (
    <span class="face" style={{ background: colourFor(name) }}>
      {initial(name)}
    </span>
  );
}

function Lobby({
  room,
  view,
  isHost,
  send,
  onLeave,
}: {
  room: PartyRoomState;
  view: PartyView;
  isHost: boolean;
  send: (m: PartyClientMessage) => void;
  onLeave: () => void;
}) {
  const host = room.players.find((p) => p.id === room.host_id);
  const connected = room.players.filter((p) => p.connected).length;
  const message = `Join my Who Sabi? party! Room ${room.code}: ${room.link}`;
  return (
    <main class="page">
      <header class="lobby-head">
        <button class="close" aria-label="Leave the room" onClick={onLeave}>
          ×
        </button>
        <p class="overline gold">Room code</p>
        <p class="code" data-testid="party-code">
          {room.code}
        </p>
        <p class="small">
          {room.settings.questions} questions · {room.settings.timer_s} s
          {room.settings.wahala ? ' · Wahala Round on' : ''}
        </p>
        <a class="button accent" href={whatsapp(message)} target="_blank" rel="noopener">
          Invite on WhatsApp
        </a>
      </header>
      <section class="stack">
        <h2>
          Players ({room.players.length}/{room.max_players})
        </h2>
        <ul class="players">
          {room.players.map((p) => (
            <li key={p.id} class={p.connected ? '' : 'away'} data-testid={`party-player-${p.name}`}>
              <Avatar name={p.name} />
              <span class="grow">
                {p.name}
                {p.id === view.you?.id ? ' (you)' : ''}
                {p.id === room.host_id ? <span class="soft small"> · Host</span> : null}
              </span>
              {isHost && p.id !== view.you?.id ? (
                <button
                  class="x"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => send({ type: 'kick', player_id: p.id })}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {isHost ? (
          <>
            {view.error ? <p class="error">{view.error.message}</p> : null}
            <button
              class="button"
              disabled={connected < PARTY_MIN_PLAYERS}
              onClick={() => send({ type: 'start' })}
              data-testid="party-start"
            >
              Start game →
            </button>
          </>
        ) : (
          <p class="soft" data-testid="party-waiting">
            Waiting for {host?.name ?? 'the host'} to start the game.
          </p>
        )}
      </section>
    </main>
  );
}

function Countdown({ room, serverNow }: { room: PartyRoomState; serverNow: () => number }) {
  const left = useTimeLeft(room.ends_at, serverNow);
  return (
    <main class="page green center">
      <h1>Get ready!</h1>
      <p class="big">{Math.max(1, Math.ceil(left / 1000))}</p>
    </main>
  );
}

function Band({ room, q }: { room: PartyRoomState; q: PartyQuestionMessage }) {
  const counter = `Q${q.index + 1} of ${q.total}`;
  return q.wahala ? (
    <div class="band wahala" data-testid="party-wahala">
      <strong>Wahala Round</strong>
      <span>Points ×2 · {counter}</span>
    </div>
  ) : (
    <div class="band">
      <strong>{counter}</strong>
      <span class="soft">Room {room.code}</span>
    </div>
  );
}

function Pill({ id }: { id: string }) {
  const c = category(id);
  return (
    <span class="pill">
      <span class="dot" style={{ background: c.color }} />
      {c.name}
    </span>
  );
}

const LETTERS = ['A', 'B', 'C', 'D'];

function Question({
  room,
  view,
  plays,
  serverNow,
  onAnswer,
}: {
  room: PartyRoomState;
  view: PartyView;
  plays: boolean;
  serverNow: () => number;
  onAnswer: (q: PartyQuestionMessage, index: number) => void;
}) {
  const q = view.question;
  const left = useTimeLeft(room.ends_at, serverNow);
  const fraction = useMemo(() => (q ? Math.min(1, left / q.time_limit_ms) : 0), [left, q]);
  if (!q || q.index !== room.q_index) {
    return <main class="page center">You come in at the next question…</main>;
  }
  const locked = view.chosen !== null;
  const answered = room.players.filter((p) => p.answered).length;
  return (
    <main class="page">
      <Band room={room} q={q} />
      <Pill id={q.category_id} />
      <h1 class="question" data-testid="question-text">
        {q.text}
      </h1>
      <div class="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
        <div class={fraction > 1 / 3 ? 'fill' : 'fill late'} style={{ width: `${fraction * 100}%` }} />
        <span>{Math.ceil(left / 1000)}s</span>
      </div>
      <div class="options">
        {q.options.map((option, i) => (
          <button
            key={i}
            class={view.chosen === i ? 'option chosen' : locked ? 'option faded' : 'option'}
            disabled={!plays || locked || left === 0}
            onClick={() => onAnswer(q, i)}
            data-testid={`option-${i}`}
          >
            <span class="letter">{LETTERS[i]}</span>
            {option}
          </button>
        ))}
      </div>
      <p class="soft small center-text">
        {plays && locked
          ? 'Locked in. Waiting for the others…'
          : `${answered} of ${room.players.length} answered`}
      </p>
    </main>
  );
}

function Reveal({ room, view, plays }: { room: PartyRoomState; view: PartyView; plays: boolean }) {
  const q = view.question;
  const reveal = view.reveal;
  if (!q || !reveal || reveal.qid !== q.qid) return <main class="page center">Next question soon…</main>;
  const total = Math.max(
    1,
    reveal.distribution.reduce((a, b) => a + b, 0),
  );
  const you = plays ? reveal.you : null;
  const board = view.board;
  const next: Record<string, string> = {
    question: 'Next question coming…',
    wahala: 'Wahala Round next!',
    last: 'Last question next…',
    podium: 'Final results next…',
  };
  return (
    <main class="page">
      <Band room={room} q={q} />
      <h2>{q.text}</h2>
      <div class="options">
        {q.options.map((option, i) => {
          const right = i === reveal.correct_display_index;
          const mine = you?.display_index === i;
          const share = Math.round((reveal.distribution[i]! / total) * 100);
          return (
            <div key={i} class={right ? 'option right' : mine ? 'option wrong' : 'option faded'}>
              <span class="bar" style={{ width: `${share}%` }} />
              <span class="letter">{right ? '✓' : mine ? '✗' : LETTERS[i]}</span>
              <span class="grow">
                {option}
                {mine ? <span class="small"> · your pick</span> : null}
              </span>
              <strong>{share}%</strong>
            </div>
          );
        })}
      </div>
      {you ? (
        <p class={you.correct ? 'result right' : 'result wrong'} data-testid="party-result">
          {you.correct
            ? 'Correct! Omo, you get am!'
            : you.display_index === null
              ? 'Time up!'
              : 'Not this one'}
          {you.correct ? <strong>+{you.points}</strong> : null}
        </p>
      ) : null}
      {reveal.fact ? (
        <p class="fact">
          <span class="overline">Did you know?</span>
          {reveal.fact}
        </p>
      ) : null}
      {board ? (
        <section class="board" data-testid="party-board">
          <div class="row head">
            <strong>Top 5</strong>
            <span class="soft small">{next[board.next]}</span>
          </div>
          {board.top.map((row) => (
            <div key={row.id} class={row.id === view.you?.id ? 'row you' : 'row'}>
              <span class="rank">{row.rank}</span>
              <span class="grow">{row.id === view.you?.id ? `You (${row.name})` : row.name}</span>
              <span class={row.move > 0 ? 'up' : row.move < 0 ? 'down' : 'soft'}>
                {row.move > 0 ? `▲${row.move}` : row.move < 0 ? `▼${-row.move}` : '–'}
              </span>
              <strong>{row.score.toLocaleString('en-NG')}</strong>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}

function Podium({
  view,
  code,
  isHost,
  onAgain,
}: {
  view: PartyView;
  code: string;
  isHost: boolean;
  onAgain: () => void;
}) {
  const podium = view.podium!;
  const winner = podium.ranking[0];
  const text = `${winner?.name ?? 'Someone'} won our Who Sabi? party! Join the next game in room ${code}: ${podium.share_url}`;
  return (
    <main class="page dark">
      <p class="overline gold center-text">Game over · Room {code}</p>
      <h1 class="center-text" data-testid="party-winner">
        {winner && winner.score > 0 ? `${winner.name} sabi pass!` : 'Nobody scored this time'}
      </h1>
      {podium.mvp ? (
        <p class="mvp">
          <span class="overline gold">MVP of the night</span>
          {podium.mvp.name} · {podium.mvp.correct} of {podium.mvp.total} right · fastest answer{' '}
          {(podium.mvp.fastest_ms / 1000).toFixed(1)} s
        </p>
      ) : null}
      <ol class="ranking">
        {podium.ranking.map((p) => (
          <li key={p.id} class={p.id === view.you?.id ? 'you' : ''}>
            <span class="rank">{p.rank}</span>
            <span class="grow">
              {p.name}
              {p.id === view.you?.id ? ' (you)' : ''}
            </span>
            <strong>{p.score.toLocaleString('en-NG')}</strong>
          </li>
        ))}
      </ol>
      <div class="stack">
        <a class="button accent" href={whatsapp(text)} target="_blank" rel="noopener">
          Share the result
        </a>
        {isHost ? (
          <button class="button" onClick={onAgain} data-testid="party-again">
            Play again
          </button>
        ) : (
          <p class="soft small center-text">Waiting for the host to start another game.</p>
        )}
        <div class="next">
          <p class="strong">Enjoyed it? Keep the trivia going.</p>
          <a class="button ghost" href={PLAY_STORE} data-testid="get-app">
            Get the app
          </a>
          <a class="link" href="/">
            Keep playing in your browser
          </a>
        </div>
      </div>
    </main>
  );
}
