/** The one API client the app uses, wired to this platform's token store. */
import { APP_VERSION, API_URL, PLATFORM } from '../config';
import { refreshToken } from '../platform/refreshToken';
import { ApiClient, type Session } from './client';

type Listener = (session: Session | null) => void;
const listeners = new Set<Listener>();
let analyticsSession: () => string | null = () => null;

export const api = new ApiClient({
  baseUrl: API_URL,
  platform: PLATFORM,
  appVersion: APP_VERSION,
  refreshToken,
  sessionId: () => analyticsSession(),
  onSession: (session) => listeners.forEach((listener) => listener(session)),
});

/** Session changes, for the session store (kept out of this file to avoid an import cycle). */
export function onSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lets the analytics tracker share its session id with server events (X-Session-Id). */
export function setAnalyticsSession(get: () => string | null): void {
  analyticsSession = get;
}

export { ApiError, errorMessage } from './client';
