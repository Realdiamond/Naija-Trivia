'use server';
import type { AdminRevealResponse } from '@whosabi/shared-types';
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
