'use server';
/** Threshold alert rules (step 2.7m): make one, switch it off or on, delete it. The API checks who may. */
import { revalidatePath } from 'next/cache';
import {
  AlertChannel,
  AlertComparison,
  AlertMetric,
  routes,
  type AlertRuleInput,
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

export async function createRule(_state: FormState, form: FormData): Promise<FormState> {
  const metric = AlertMetric.safeParse(text(form, 'metric'));
  const comparison = AlertComparison.safeParse(text(form, 'comparison'));
  const channels = form.getAll('channels').flatMap((c) => {
    const parsed = AlertChannel.safeParse(String(c));
    return parsed.success ? [parsed.data] : [];
  });
  if (!metric.success || !comparison.success)
    return { done: null, error: 'Choose what to watch and when to alert.' };
  if (channels.length === 0) return { done: null, error: 'Choose at least one place for the alert to go.' };
  const body: AlertRuleInput = {
    name: text(form, 'name'),
    metric: metric.data,
    comparison: comparison.data,
    threshold: Number(text(form, 'threshold')),
    window_minutes: Number(text(form, 'window_minutes')),
    channels,
  };
  try {
    await adminApi(routes.admin.alertRules, { method: 'POST', body });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/alerts');
  return { done: 'Rule added. It is checked every minute.', error: null };
}

export async function switchRule(id: string, enabled: boolean): Promise<void> {
  await adminApi(routes.admin.alertRule(id), { method: 'POST', body: { enabled } });
  revalidatePath('/alerts');
}

export async function deleteRule(id: string): Promise<void> {
  await adminApi(routes.admin.alertRule(id), { method: 'DELETE' });
  revalidatePath('/alerts');
}
