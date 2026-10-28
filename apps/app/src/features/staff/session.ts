/**
 * Staff tools on this phone (build plan step 2.9a): a 30-day staff session from the API, kept in
 * the phone's secure storage, and a lock that the fingerprint or phone PIN opens. The lock closes
 * whenever the app leaves the screen. Staff text is in English, like the console.
 */
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { routes, type AdminProfile, type AdminSessionResponse } from '@whosabi/shared-types';
import { ApiError } from '../../api/client';
import { googleIdToken } from '../../auth/GoogleButton';
import { API_URL } from '../../config';
import { staffPushToken } from '../../platform/push';
import { phoneHasLock, staffToolsHere, unlockStaff } from '../../platform/staffLock';
import { staffToken } from '../../platform/staffToken';

interface Stored {
  token: string;
  expires_at: string;
  admin: AdminProfile;
}

interface StaffState {
  loaded: boolean;
  session: Stored | null;
  unlocked: boolean;
}

export const useStaff = create<StaffState>(() => ({ loaded: false, session: null, unlocked: false }));

let watching = false;

/** Reads the saved session once, and locks staff tools whenever the app goes to the background. */
export async function loadStaff(): Promise<void> {
  if (useStaff.getState().loaded) return;
  if (!watching && staffToolsHere) {
    watching = true;
    AppState.addEventListener('change', (state) => {
      if (state !== 'active') useStaff.setState({ unlocked: false });
    });
  }
  const session = await savedSession();
  useStaff.setState({ loaded: true, session, unlocked: false });
  if (session) void registerStaffPush();
}

/** The saved session, unless it has run out or can't be read. */
async function savedSession(): Promise<Stored | null> {
  try {
    const raw = await staffToken.get();
    const session = raw ? (JSON.parse(raw) as Stored) : null;
    return session && Date.parse(session.expires_at) > Date.now() ? session : null;
  } catch {
    return null;
  }
}

/** This phone's name in the console's list of staff phones. */
function phoneLabel(): string {
  const c = Platform.constants as { Manufacturer?: string; Brand?: string; Model?: string };
  return [c.Manufacturer ?? c.Brand, c.Model].filter(Boolean).join(' ').slice(0, 60) || 'Phone';
}

export type SignInOutcome = 'ok' | 'cancelled' | 'no_lock';

/** Google's account picker, then a 30-day staff session for this phone. */
export async function staffSignIn(): Promise<SignInOutcome> {
  if (!(await phoneHasLock())) return 'no_lock';
  const idToken = await googleIdToken();
  if (!idToken) return 'cancelled';
  const res = await fetch(`${API_URL}${routes.admin.authPhone()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ id_token: idToken, label: phoneLabel() }),
  });
  const body = await read<AdminSessionResponse>(res);
  const session: Stored = { token: body.token, expires_at: body.expires_at, admin: body.admin };
  await staffToken.set(JSON.stringify(session));
  // They just proved who they are with Google: no need to unlock straight away.
  useStaff.setState({ session, unlocked: true });
  void registerStaffPush();
  return 'ok';
}

export async function staffUnlock(): Promise<boolean> {
  const ok = await unlockStaff();
  if (ok) useStaff.setState({ unlocked: true });
  return ok;
}

/** Signs this phone out of staff tools (the API ends its session too). */
export async function staffSignOut(): Promise<void> {
  const token = useStaff.getState().session?.token;
  if (token) {
    await fetch(`${API_URL}${routes.admin.authLogout()}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  await forget();
}

async function forget(): Promise<void> {
  await staffToken.clear();
  useStaff.setState({ session: null, unlocked: false });
}

/** Staff alerts come to this phone: its push token, sent on every start (it can change). */
async function registerStaffPush(): Promise<void> {
  const token = await staffPushToken();
  if (token) await staffSend('POST', routes.admin.phonePush(), { push_token: token }).catch(() => undefined);
}

/** A call to the admin API with this phone's staff session. A refused session signs the phone out. */
export function staffGet<T>(path: string): Promise<T> {
  return staffSend<T>('GET', path);
}

export async function staffSend<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const token = useStaff.getState().session?.token;
  if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Signed out of staff tools');
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Ended, signed out from the console, or no longer an owner or admin.
  if (res.status === 401 || res.status === 403) await forget();
  return read<T>(res);
}

async function read<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (res.ok) return data as T;
  const problem = (data ?? {}) as { code?: string; title?: string; detail?: string };
  throw new ApiError(
    res.status,
    problem.code ?? 'INTERNAL',
    problem.title ?? 'Something went wrong',
    problem.detail,
  );
}
