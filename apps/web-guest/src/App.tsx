/**
 * whosabi.ng/r/{CODE} without the app (UX §1, mockup 29): the room's card and a nickname, then
 * the game itself. A seat taken here is kept for the session, so a reload goes straight back in.
 */
import { useState } from 'preact/hooks';
import { normaliseRoomCode } from '@whosabi/game-rules';
import { seatFor } from './api';
import { Join } from './Join';
import { Room } from './Room';

export function App() {
  const code = normaliseRoomCode(location.pathname.split('/')[2] ?? '');
  const [seat, setSeat] = useState(() => (code ? seatFor(code) : null));
  if (!code) {
    return (
      <main class="page center">
        <h1>That link is not a party room.</h1>
        <a class="button" href="/">
          Open Who Sabi?
        </a>
      </main>
    );
  }
  return seat ? <Room seat={seat} onLeave={() => setSeat(null)} /> : <Join code={code} onSeat={setSeat} />;
}
