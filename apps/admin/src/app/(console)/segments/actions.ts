'use server';
/** Segments (step 2.7o): count one being built, save it, delete it, ask to export it, decide on an export. */
import { revalidatePath } from 'next/cache';
import { routes, SegmentDefinition } from '@whosabi/shared-types';
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

function definitionFrom(form: FormData) {
  try {
    return SegmentDefinition.safeParse(JSON.parse(text(form, 'definition')));
  } catch {
    return SegmentDefinition.safeParse(null);
  }
}

/** The size of the segment being built; the name is not needed yet. */
export async function countDraft(_state: FormState, form: FormData): Promise<FormState> {
  const definition = definitionFrom(form);
  if (!definition.success) return { done: null, error: 'Add at least one complete condition.' };
  try {
    const { players } = await adminApi<{ players: number }>(routes.admin.segmentCount, {
      method: 'POST',
      body: { definition: definition.data },
    });
    return { done: `${players.toLocaleString('en-NG')} players right now.`, error: null };
  } catch (e) {
    return failed(e);
  }
}

export async function saveSegment(_state: FormState, form: FormData): Promise<FormState> {
  const definition = definitionFrom(form);
  if (!definition.success) return { done: null, error: 'Add at least one complete condition.' };
  try {
    const { players } = await adminApi<{ players: number }>(routes.admin.segments, {
      method: 'POST',
      body: { name: text(form, 'name'), definition: definition.data },
    });
    revalidatePath('/segments');
    return { done: `Saved: ${players.toLocaleString('en-NG')} players.`, error: null };
  } catch (e) {
    return failed(e);
  }
}

export async function deleteSegment(id: string): Promise<void> {
  await adminApi(routes.admin.segment(id), { method: 'DELETE' });
  revalidatePath('/segments');
}

export async function askExport(id: string, _state: FormState, form: FormData): Promise<FormState> {
  try {
    await adminApi(routes.admin.segmentExports(id), {
      method: 'POST',
      body: { reason: text(form, 'reason') },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/segments');
  return { done: 'Asked. An owner or admin approves it.', error: null };
}

export async function decideExport(id: string, approve: boolean): Promise<void> {
  await adminApi(routes.admin.segmentExportDecision(id), { method: 'POST', body: { approve } });
  revalidatePath('/segments');
}
