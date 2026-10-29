'use server';
import { revalidatePath } from 'next/cache';
import {
  routes,
  type AdminNotesResponse,
  type AdminPlayerAction,
  type AdminPlayerActionResponse,
  type AdminRevealResponse,
} from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../../lib/api';

export interface RevealState {
  value: string | null;
  error: string | null;
}

/** Reveal needs a reason, and the API logs it before showing anything (doc 18 AD-5). */
export async function reveal(userId: string, _state: RevealState, form: FormData): Promise<RevealState> {
  try {
    const res = await adminApi<AdminRevealResponse>(`/admin/users/${encodeURIComponent(userId)}/reveal`, {
      method: 'POST',
      body: { field: 'phone', reason: String(form.get('reason') ?? '') },
    });
    return { value: res.value ?? 'No phone number on this account', error: null };
  } catch (e) {
    return { value: null, error: e instanceof AdminApiError ? e.message : 'Reveal failed.' };
  }
}

export interface ActionState {
  done: string | null;
  error: string | null;
}

const failed = (e: unknown, fallback: string): ActionState => ({
  done: null,
  error: e instanceof AdminApiError ? e.message : fallback,
});

/** A staff note on the player, never shown to them. */
export async function addNote(userId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  try {
    await adminApi<AdminNotesResponse>(routes.admin.userNotes(userId), {
      method: 'POST',
      body: { body: String(form.get('body') ?? '') },
    });
  } catch (e) {
    return failed(e, 'The note was not saved.');
  }
  revalidatePath(`/players/${userId}`);
  return { done: 'Note saved.', error: null };
}

/** The action the form describes; the API checks it, and who may. */
function actionFrom(form: FormData): AdminPlayerAction {
  const type = String(form.get('type') ?? '');
  const reason = String(form.get('reason') ?? '');
  switch (type) {
    case 'grant_coins':
      return { type, amount: Number(form.get('amount') ?? 0), reason };
    case 'warn':
      return { type, message: String(form.get('message') ?? ''), reason };
    case 'ban': {
      const days = String(form.get('days') ?? '');
      return { type, days: days === 'forever' ? null : Number(days), reason };
    }
    case 'restore_streak':
    case 'rename':
    case 'shadow_restrict':
    case 'unrestrict':
    case 'unban':
      return { type, reason };
    default:
      return { type: 'sign_out', reason };
  }
}

/** Support's and moderators' actions (doc 18 §8), always with a reason. */
export async function playerAction(
  userId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const body = actionFrom(form);
  let res: AdminPlayerActionResponse;
  try {
    res = await adminApi<AdminPlayerActionResponse>(routes.admin.userActions(userId), {
      method: 'POST',
      body,
    });
  } catch (e) {
    return failed(e, 'That did not work. Try again.');
  }
  revalidatePath(`/players/${userId}`);
  return { done: res.done, error: null };
}
