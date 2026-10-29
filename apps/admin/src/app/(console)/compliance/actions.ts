'use server';
/** Compliance's changes (step 2.8a): log a data request, erase an account. The API checks who may. */
import { revalidatePath } from 'next/cache';
import { routes } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';

export interface FormState {
  done: string | null;
  error: string | null;
}

const failed = (e: unknown): FormState => ({
  done: null,
  error: e instanceof AdminApiError ? e.message : 'That did not work. Try again.',
});
const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

export async function startDsar(userId: string, _state: FormState, form: FormData): Promise<FormState> {
  try {
    await adminApi(routes.admin.userDsar(userId), {
      method: 'POST',
      body: { kind: text(form, 'kind') === 'erasure' ? 'erasure' : 'access', note: text(form, 'note') },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/compliance');
  return { done: 'Logged. The DPO completes it within 30 days.', error: null };
}

export async function eraseUser(userId: string, _state: FormState, form: FormData): Promise<FormState> {
  if (text(form, 'confirm').toUpperCase() !== 'ERASE') return { done: null, error: 'Type ERASE to confirm.' };
  try {
    await adminApi(routes.admin.userErase(userId), {
      method: 'POST',
      body: { reason: text(form, 'reason') },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/compliance');
  revalidatePath(`/players/${userId}`);
  return { done: 'Erased.', error: null };
}
