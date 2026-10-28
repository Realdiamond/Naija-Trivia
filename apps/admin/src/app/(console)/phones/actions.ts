'use server';
/** Signing a staff phone out of staff tools (step 2.9a). The API checks who may. */
import { revalidatePath } from 'next/cache';
import { routes } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';

export async function signOutPhone(id: string): Promise<{ error: string | null }> {
  try {
    await adminApi(routes.admin.revokePhone(id), { method: 'POST' });
  } catch (e) {
    return { error: e instanceof AdminApiError ? e.message : 'That did not work. Try again.' };
  }
  revalidatePath('/phones');
  return { error: null };
}
