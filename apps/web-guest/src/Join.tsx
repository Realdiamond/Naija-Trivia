/** "You're joining Tolu's party" (mockup 29): who is in, and a nickname is all it takes. */
import { useEffect, useState } from 'preact/hooks';
import type { PartyRoomPreview, PartySeat } from '@whosabi/shared-types';
import { join, preview, RequestError, saveSeat } from './api';
import { fullApp } from './links';

export function Join({ code, onSeat }: { code: string; onSeat: (seat: PartySeat) => void }) {
  const [room, setRoom] = useState<PartyRoomPreview | null>(null);
  const [missing, setMissing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      preview(code).then(
        (r) => live && (setRoom(r), setMissing(false)),
        (e: unknown) => live && e instanceof RequestError && e.status === 404 && setMissing(true),
      );
    void load();
    // Who is in changes as people arrive.
    const timer = setInterval(() => void load(), 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [code]);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const seat = await join(code, nickname.trim());
      saveSeat(seat);
      onSeat(seat);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <main class="page dark">
      <p class="brand">
        Who Sabi? <span class="gold">Party</span>
      </p>
      {missing ? (
        <section class="stack">
          <h1>This party is not on.</h1>
          <p class="soft">Check the code, or ask for a new link.</p>
          <a class="button accent" href="/">
            Start your own party
          </a>
        </section>
      ) : !room ? (
        <p class="soft">Loading the room…</p>
      ) : (
        <form class="stack" onSubmit={submit}>
          <p class="overline gold">Room {room.code}</p>
          <h1 data-testid="party-joining">You're joining {room.host}'s party</h1>
          <div class="people">
            <div class="faces">
              {room.names.map((name, i) => (
                <span key={`${name}${i}`} class="face" style={{ background: colourFor(name) }}>
                  {initial(name)}
                </span>
              ))}
            </div>
            <span>
              {room.players} {room.players === 1 ? 'person is' : 'people are'} in the lobby
            </span>
          </div>
          {room.status !== 'lobby' ? (
            <p class="soft">They are playing now: you come in at the next question.</p>
          ) : null}
          <label class="field">
            <span>Your nickname</span>
            <input
              value={nickname}
              onInput={(e) => setNickname((e.target as HTMLInputElement).value)}
              placeholder="e.g. Big Bolu"
              maxLength={20}
              autoComplete="nickname"
              data-testid="party-nickname"
            />
          </label>
          <p class="soft small">That's all. No app, no sign-up.</p>
          {error ? (
            <p class="error" role="alert" data-testid="party-join-error">
              {error}
            </p>
          ) : null}
          <button
            class="button accent"
            type="submit"
            disabled={busy || nickname.trim().length < 2}
            data-testid="party-join"
          >
            {busy ? 'Joining…' : 'Join the game →'}
          </button>
          <a class="link" href={fullApp(code)}>
            Have an account? Sign in to keep your score
          </a>
        </form>
      )}
      <p class="soft small footnote">
        Works in Chrome, Safari, Samsung Internet, Opera and the WhatsApp browser. On Opera Mini? Open this
        link in Chrome.
      </p>
    </main>
  );
}

const PALETTE = ['#8E44AD', '#1F5F8B', '#7A5A1E', '#14231B', '#C0392B', '#008751'];

export function colourFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

export const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();
