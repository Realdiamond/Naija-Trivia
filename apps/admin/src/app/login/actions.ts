'use server';
/** Staff sign-in and sign-out (doc 18 §16): the API checks the staff list and starts the session. */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AdminSessionResponse } from '@whosabi/shared-types';
import { AdminApiError, adminApi, SESSION_COOKIE } from '../../lib/api';

export interface SignInState {
  error: string | null;
}

async function keep(session: AdminSessionResponse): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: new Date(session.expires_at),
  });
}

async function signIn(path: string, body: object): Promise<SignInState> {
  try {
    await keep(await adminApi<AdminSessionResponse>(path, { method: 'POST', body, token: null }));
  } catch (error) {
    return { error: error instanceof AdminApiError ? error.message : 'The API is not answering. Try again.' };
  }
  redirect('/');
}

export async function signInWithGoogle(idToken: string): Promise<SignInState> {
  return signIn('/admin/auth/google', { id_token: idToken });
}

/** Development only: the API has no such route in production. */
export async function devSignIn(_state: SignInState, form: FormData): Promise<SignInState> {
  return signIn('/admin/auth/dev', { email: String(form.get('email') ?? '') });
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await adminApi('/admin/auth/logout', { method: 'POST', token }).catch(() => undefined);
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}
