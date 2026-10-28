'use server';
/**
 * Content changes (doc 18 §12). The API checks every permission and the Question Bible, and logs
 * each change; these only shape the form into the API's request and report back.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type {
  AdminBulkPublishResponse,
  AdminImportResponse,
  AdminQuestion,
  AdminQuestionInput,
  QuestionAction,
} from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';

export interface FormState {
  message: string | null;
  error: boolean;
}

const failed = (e: unknown): FormState => ({
  message: e instanceof AdminApiError ? e.message : 'That did not work. Try again.',
  error: true,
});

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

function inputFrom(form: FormData): AdminQuestionInput {
  const type = text(form, 'type') as AdminQuestionInput['type'];
  const count = type === 'mcq4' ? 4 : type === 'true_false' ? 2 : 0;
  return {
    category_id: text(form, 'category_id') as AdminQuestionInput['category_id'],
    subcategory: text(form, 'subcategory') || null,
    type,
    text: text(form, 'text'),
    options: Array.from({ length: count }, (_, i) => text(form, `option${i}`)),
    correct_index: type === 'closest_number' ? null : Number(text(form, 'correct') || 0),
    numeric_answer:
      type === 'closest_number' && text(form, 'numeric') !== '' ? Number(text(form, 'numeric')) : null,
    fact: text(form, 'fact') || null,
    difficulty: Number(text(form, 'difficulty')),
    family_safe: form.get('family_safe') === 'on',
    region_tag: (text(form, 'region_tag') || null) as AdminQuestionInput['region_tag'],
    valid_until: text(form, 'valid_until') || null,
    source_url: text(form, 'source_url') || null,
    trending: form.get('trending') === 'on',
  };
}

/** Creates a draft (then opens it) or saves an edit as a new version. */
export async function saveQuestion(_state: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');
  const input = inputFrom(form);
  let created: string | null = null;
  try {
    if (id) {
      await adminApi(`/admin/questions/${encodeURIComponent(id)}`, { method: 'PUT', body: input });
    } else {
      created = (await adminApi<AdminQuestion>('/admin/questions', { method: 'POST', body: input })).id;
    }
  } catch (e) {
    return failed(e);
  }
  if (created) redirect(`/questions/${created}?saved=1`);
  revalidatePath(`/questions/${id}`);
  return { message: 'Saved.', error: false };
}

export async function moveQuestion(id: string, action: QuestionAction, note: string): Promise<FormState> {
  try {
    await adminApi(`/admin/questions/${encodeURIComponent(id)}/actions`, {
      method: 'POST',
      body: { action, ...(note.trim() ? { note: note.trim() } : {}) },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/questions/${id}`);
  revalidatePath('/questions');
  return { message: 'Done.', error: false };
}

export async function publishMany(ids: string[]): Promise<FormState> {
  try {
    const result = await adminApi<AdminBulkPublishResponse>('/admin/questions/publish', {
      method: 'POST',
      body: { ids },
    });
    revalidatePath('/questions');
    return {
      message: `${result.published} published${result.skipped.length ? `, ${result.skipped.length} skipped (no longer approved, or failing a check)` : ''}.`,
      error: false,
    };
  } catch (e) {
    return failed(e);
  }
}

export async function importCsv(
  csv: string,
  dryRun: boolean,
  publishApproved: boolean,
): Promise<{ result: AdminImportResponse | null; error: string | null }> {
  try {
    const result = await adminApi<AdminImportResponse>('/admin/questions/import', {
      method: 'POST',
      body: { csv, dry_run: dryRun, publish_approved: publishApproved },
    });
    if (!dryRun) revalidatePath('/questions');
    return { result, error: null };
  } catch (e) {
    return { result: null, error: failed(e).message };
  }
}

export async function resolveReports(
  id: string,
  resolution: 'fixed' | 'rejected' | 'retired',
  note: string,
): Promise<FormState> {
  try {
    await adminApi(`/admin/questions/${encodeURIComponent(id)}/reports/resolve`, {
      method: 'POST',
      body: { resolution, ...(note.trim() ? { note: note.trim() } : {}) },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/reports');
  revalidatePath(`/questions/${id}`);
  return { message: 'Reports closed.', error: false };
}

/** Another 90 days in the game for a trending question. */
export async function renewQuestion(id: string): Promise<FormState> {
  try {
    await adminApi(`/admin/questions/${encodeURIComponent(id)}/renew`, { method: 'POST' });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/questions/${id}`);
  return { message: 'Renewed for 90 days.', error: false };
}
