'use server';
/** The Daily scheduler's changes (step 2.7f): plan ahead, swap a question. The API checks who may. */
import { revalidatePath } from 'next/cache';
import { routes, type AdminDailyPlanResponse } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';

export interface FormState {
  done: string | null;
  error: string | null;
}

const failed = (e: unknown): FormState => ({
  done: null,
  error: e instanceof AdminApiError ? e.message : 'That did not work. Try again.',
});

export async function planDailies(_state: FormState, form: FormData): Promise<FormState> {
  let res: AdminDailyPlanResponse;
  try {
    res = await adminApi<AdminDailyPlanResponse>(routes.admin.dailyPlan(), {
      method: 'POST',
      body: { reason: String(form.get('reason') ?? '') },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/daily');
  const short = res.short.length ? ` Not enough questions for ${res.short.join(', ')}.` : '';
  return { done: `Planned ${res.planned} Dailies.${short}`, error: null };
}

export async function swapQuestion(
  date: string,
  slot: number,
  questionId: string,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    await adminApi(routes.admin.dailySwap(date), {
      method: 'POST',
      body: { slot, question_id: questionId, reason: String(form.get('reason') ?? '') },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/daily/${date}`);
  revalidatePath('/daily');
  return { done: 'Swapped.', error: null };
}
