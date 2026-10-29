'use server';
/** Packs (step 2.8f): make or change one, add questions by id or reference, take one out. The API checks who may. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  CategoryId,
  PackAccess,
  routes,
  type AdminPack,
  type AdminPackInput,
  type AdminPackQuestionsAdded,
} from '@whosabi/shared-types';
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
/** A datetime-local value, read as WAT. */
const fromWat = (value: string) => (value ? new Date(`${value}:00+01:00`).toISOString() : null);

export async function savePack(id: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const access = PackAccess.safeParse(text(form, 'access'));
  if (!access.success) return { done: null, error: 'Choose who can play it.' };
  const category = text(form, 'category_id');
  const parsedCategory = CategoryId.safeParse(category);
  const body: AdminPackInput = {
    title: text(form, 'title'),
    slug: text(form, 'slug'),
    description: text(form, 'description') || null,
    access: access.data,
    price_coins: access.data === 'coins' ? Number(text(form, 'price_coins')) : null,
    category_id: parsedCategory.success ? parsedCategory.data : null,
    starts_at: fromWat(text(form, 'starts_at')),
    ends_at: fromWat(text(form, 'ends_at')),
    active: form.get('active') === 'on',
  };
  let saved: AdminPack;
  try {
    saved = await adminApi<AdminPack>(id ? routes.admin.pack(id) : routes.admin.packs, {
      method: id ? 'PUT' : 'POST',
      body,
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/packs');
  if (!id) redirect(`/packs/${saved.id}`);
  revalidatePath(`/packs/${id}`);
  return { done: 'Saved.', error: null };
}

export async function addQuestions(id: string, _state: FormState, form: FormData): Promise<FormState> {
  const refs = text(form, 'refs')
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (refs.length === 0) return { done: null, error: 'Paste question ids or references.' };
  if (refs.length > 300) return { done: null, error: 'At most 300 at a time.' };
  let result: AdminPackQuestionsAdded;
  try {
    result = await adminApi<AdminPackQuestionsAdded>(routes.admin.packQuestions(id), {
      method: 'POST',
      body: { refs },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/packs/${id}`);
  const parts = [`${result.added} added`];
  if (result.already > 0) parts.push(`${result.already} already in it`);
  if (result.unknown.length > 0) parts.push(`not found: ${result.unknown.join(', ')}`);
  return { done: `${parts.join('; ')}.`, error: null };
}

export async function removeQuestion(id: string, qid: string): Promise<void> {
  await adminApi(routes.admin.packQuestion(id, qid), { method: 'DELETE' });
  revalidatePath(`/packs/${id}`);
}
