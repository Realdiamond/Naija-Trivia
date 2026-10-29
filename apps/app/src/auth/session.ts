/**
 * Who is playing: the signed-in player (a guest or an account) or nobody yet.
 *
 * On start the app renews its session from the refresh token (a cookie on the web, the Keystore
 * on phones). With none, the player is signed out until they tap "Start playing", which signs
 * them in as a guest tied to this device (doc 09 §2.1).
 */
import { create } from 'zustand';
import { ErrorCode, type PublicUser } from '@whosabi/shared-types';
import { ApiError, type Session } from '../api/client';
import { api, onSession } from '../api';
import { queryClient } from '../api/queryClient';
import { forgetPractice } from '../features/practice/store';
import { forgetPush } from '../platform/push';
import { storage } from '../platform/storage';
import { randomId } from '../platform/random';

export type SessionStatus = 'loading' | 'offline' | 'signed_out' | 'guest' | 'account';

interface SessionState {
  status: SessionStatus;
  user: PublicUser | null;
}

export const useSession = create<SessionState>(() => ({ status: 'loading', user: null }));

const DEVICE_KEY = 'whosabi.device';

function statusOf(session: Session | null): SessionStatus {
  if (!session) return 'signed_out';
  return session.user.status === 'guest' ? 'guest' : 'account';
}

/** Keeps the store in step with the client: sign-ins, refreshes and sign-outs all land here. */
export function onSessionChange(session: Session | null): void {
  const before = useSession.getState();
  const status = statusOf(session);
  // A different player, or a guest who just signed up: nothing cached belongs to them.
  if (before.user?.id !== session?.user.id || (before.status !== status && before.status !== 'loading')) {
    queryClient.clear();
  }
  useSession.setState({ status, user: session?.user ?? null });
}

onSession(onSessionChange);

/** Called once at launch, and again from the "Try again" button when the network was down. */
export async function restoreSession(): Promise<void> {
  useSession.setState({ status: 'loading' });
  try {
    const session = await api.refresh();
    if (!session) useSession.setState({ status: 'signed_out', user: null });
  } catch {
    // No network, or the API is down: the session may still be valid, so keep the token.
    useSession.setState({ status: 'offline' });
  }
}

/** This install's (or browser's) id, made once and kept. */
export async function deviceId(): Promise<string> {
  const saved = await storage.getItem(DEVICE_KEY);
  if (saved) return saved;
  const id = randomId();
  await storage.setItem(DEVICE_KEY, id);
  return id;
}

export type GuestResult = 'ok' | 'account_device';

/**
 * Makes sure someone is signed in, as a guest if need be. A device that already belongs to an
 * account can't go back to being a guest: that player signs in instead.
 */
export async function ensureSignedIn(): Promise<GuestResult> {
  if (api.current) return 'ok';
  try {
    await api.signInGuest(await deviceId());
    return 'ok';
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.code === ErrorCode.conflict) {
      return 'account_device';
    }
    throw error;
  }
}

export async function signOut(): Promise<void> {
  // Pushes for this player stop coming to this phone, and their practice packs leave it.
  await forgetPush();
  await forgetPractice();
  await api.logout().catch(() => undefined);
}

/** After PATCH /v1/me changes what the session shows (the username, for now). */
export function updateUser(changes: Partial<PublicUser>): void {
  const user = useSession.getState().user;
  if (user) useSession.setState({ user: { ...user, ...changes } });
}
