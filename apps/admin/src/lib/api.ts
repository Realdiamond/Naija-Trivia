/**
 * Calls to the admin API (doc 09 §2.10), from the server only: the staff session token lives in
 * an HttpOnly cookie on the console's own domain and never reaches the browser's JavaScript.
 */
import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

export const SESSION_COOKIE = 'wsa_session';

/** The core API; the console talks to it server to server, so no CORS is involved. */
export const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    title: string,
    readonly detail?: string,
  ) {
    super(detail ? `${title}. ${detail}` : title);
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Send this token instead of the session cookie (signing in). */
  token?: string | null;
}

/** A request with the staff session; an ended session goes back to the sign-in page. */
export async function adminApi<T>(path: string, options: Options = {}): Promise<T> {
  const token = options.token === undefined ? (await cookies()).get(SESSION_COOKIE)?.value : options.token;
  // The audit log records the staff member's address, not this server's (doc 18 §16).
  const forwardedFor = (await headers()).get('x-forwarded-for');
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });
  if (res.status === 401 && options.token === undefined) redirect('/login?expired=1');
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new AdminApiError(
      res.status,
      String(data.code ?? 'INTERNAL'),
      String(data.title ?? 'Something went wrong'),
      typeof data.detail === 'string' ? data.detail : undefined,
    );
  }
  return data as T;
}
