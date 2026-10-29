/**
 * The two calls the light client makes before the room's WebSocket takes over: the room's card,
 * and a seat with a nickname (API §2.7). A seat is kept for the session under the same key as
 * the full web app's, so a reload, or opening the full app, finds it.
 */
import type { Problem } from '@whosabi/shared-types';
import type { PartyRoomPreview, PartySeat } from '@whosabi/shared-types/party-protocol';
// Entry points with no runtime dependencies: the validation library stays out of this bundle.
import { routes } from '@whosabi/shared-types/routes';

export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new RequestError(0, 'NETWORK', 'No connection. Check your data and try again.');
  }
  if (res.ok) return (await res.json()) as T;
  const problem = (await res.json().catch(() => null)) as Problem | null;
  throw new RequestError(
    res.status,
    problem?.code ?? 'UNKNOWN',
    problem?.detail ? `${problem.title}. ${problem.detail}` : (problem?.title ?? 'Something went wrong.'),
  );
}

export const preview = (code: string) => call<PartyRoomPreview>(routes.partyRoom(code));

export const join = (code: string, nickname: string) =>
  call<PartySeat>(routes.partyJoin(code), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });

const STORE_KEY = 'whosabi.party.seats';

function seats(): Record<string, PartySeat> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '{}') as Record<string, PartySeat>;
  } catch {
    return {};
  }
}

export function seatFor(code: string): PartySeat | null {
  const seat = seats()[code];
  return seat && Date.parse(seat.expires_at) > Date.now() ? seat : null;
}

export function saveSeat(seat: PartySeat): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...seats(), [seat.code]: seat }));
  } catch {
    // Private mode: the seat lasts as long as the page.
  }
}

export function forgetSeat(code: string): void {
  try {
    const all = seats();
    delete all[code];
    sessionStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // Nothing kept, nothing to forget.
  }
}
