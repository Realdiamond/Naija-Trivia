/**
 * Party rooms over HTTP (API §2.7): make one, read a room's card, take a seat. A seat is kept
 * for the session (on the web, through a reload too), so a dropped player comes back to the
 * same seat with their points.
 */
import {
  routes,
  type CreatePartyRequest,
  type CreatePartyResponse,
  type JoinPartyRequest,
  type PartyRoomPreview,
  type PartySeat,
} from '@whosabi/shared-types';
import { api } from '../../api';
import { API_URL } from '../../config';

export const party = {
  create: (body: CreatePartyRequest) => api.post<CreatePartyResponse>(routes.partyRooms(), body),
  preview: (code: string) => api.get<PartyRoomPreview>(routes.partyRoom(code), { auth: 'none' }),
  /** Signed in, as yourself; otherwise as a web guest with a nickname. */
  join: (code: string, body: JoinPartyRequest, signedIn: boolean) =>
    api.post<PartySeat>(routes.partyJoin(code), body, { auth: signedIn ? 'required' : 'none' }),
  qr: async (code: string): Promise<string> => {
    const res = await fetch(`${API_URL}${routes.partyQr(code)}`);
    if (!res.ok) throw new Error(`QR ${res.status}`);
    return res.text();
  },
};

const STORE_KEY = 'whosabi.party.seats';
const seats = new Map<string, PartySeat>(readStored());

export function saveSeat(seat: PartySeat): void {
  seats.set(seat.code, seat);
  writeStored();
}

/** The seat for a room code, while it is still good. */
export function seatFor(code: string): PartySeat | null {
  const seat = seats.get(code.toUpperCase());
  return seat && Date.parse(seat.expires_at) > Date.now() ? seat : null;
}

export function forgetSeat(code: string): void {
  seats.delete(code.toUpperCase());
  writeStored();
}

function readStored(): Array<[string, PartySeat]> {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORE_KEY);
    return raw
      ? (Object.entries(JSON.parse(raw) as Record<string, PartySeat>) as Array<[string, PartySeat]>)
      : [];
  } catch {
    return [];
  }
}

function writeStored(): void {
  try {
    globalThis.sessionStorage?.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(seats)));
  } catch {
    // Private mode or no storage: the seat lasts as long as the page.
  }
}
