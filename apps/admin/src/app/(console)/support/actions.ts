'use server';
/** Support's answers (step 2.7p): in the app's words, by email from the helpdesk, or open again. The API checks who may. */
import { revalidatePath } from 'next/cache';
import { routes, type AdminSupportTicketUpdate } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';

export interface FormState {
  done: string | null;
  error: string | null;
}

async function update(id: string, userId: string, body: AdminSupportTicketUpdate): Promise<FormState> {
  try {
    await adminApi(routes.admin.supportTicket(id), { method: 'POST', body });
  } catch (e) {
    return { done: null, error: e instanceof AdminApiError ? e.message : 'That did not work. Try again.' };
  }
  revalidatePath('/support');
  revalidatePath(`/players/${userId}`);
  return { done: body.status === 'answered' ? 'Answered.' : 'Open again.', error: null };
}

export async function answerTicket(
  id: string,
  userId: string,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const answer = String(form.get('answer') ?? '').trim();
  if (!answer) return { done: null, error: 'Write the answer the player will read in the app.' };
  return update(id, userId, { status: 'answered', answer });
}

export async function answeredByEmail(id: string, userId: string): Promise<void> {
  await update(id, userId, { status: 'answered' });
}

export async function reopenTicket(id: string, userId: string): Promise<void> {
  await update(id, userId, { status: 'open' });
}
