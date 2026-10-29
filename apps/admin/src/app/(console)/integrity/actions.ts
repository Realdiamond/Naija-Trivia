'use server';
/** A moderator's decision on an integrity flag (step 2.7d). The API checks who may. */
import { revalidatePath } from 'next/cache';
import { routes, type AdminIntegrityReview } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';

export interface ReviewState {
  error: string | null;
}

export async function reviewFlag(id: number, _state: ReviewState, form: FormData): Promise<ReviewState> {
  const body: AdminIntegrityReview = {
    status: form.get('decision') === 'actioned' ? 'actioned' : 'dismissed',
    note: String(form.get('note') ?? '').trim(),
  };
  try {
    await adminApi(routes.admin.integrityReview(id), { method: 'POST', body });
  } catch (e) {
    return { error: e instanceof AdminApiError ? e.message : 'That did not work. Try again.' };
  }
  revalidatePath('/integrity');
  return { error: null };
}
