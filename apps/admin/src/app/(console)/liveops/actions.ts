'use server';
/** LiveOps changes (step 2.7c): a flag or kill switch, and the status banner. The API checks who may. */
import { revalidatePath } from 'next/cache';
import { routes, type AdminFlagRule, type AdminFlagUpdate, type StatusBanner } from '@whosabi/shared-types';
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

/** One rule from the form's platform, minimum version and share of players; none means everyone. */
function ruleFrom(form: FormData): AdminFlagRule[] {
  const rule: AdminFlagRule = {};
  const platform = text(form, 'platform');
  if (platform === 'android' || platform === 'ios' || platform === 'web') rule.platform = platform;
  if (text(form, 'min_app_version')) rule.min_app_version = text(form, 'min_app_version');
  if (text(form, 'percent')) rule.percent = Number(text(form, 'percent'));
  return Object.keys(rule).length ? [rule] : [];
}

export async function saveFlag(key: string, _state: FormState, form: FormData): Promise<FormState> {
  const body: AdminFlagUpdate = {
    enabled: form.get('enabled') === 'on',
    rules: ruleFrom(form),
    reason: text(form, 'reason'),
  };
  try {
    await adminApi(routes.admin.flag(key), { method: 'POST', body });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/liveops');
  return { done: body.enabled ? 'Saved: on.' : 'Saved: switched off.', error: null };
}

export async function saveBanner(_state: FormState, form: FormData): Promise<FormState> {
  const takeDown = form.get('intent') === 'clear';
  const banner: StatusBanner | null = takeDown
    ? null
    : {
        level: form.get('level') === 'info' ? 'info' : 'warning',
        text_en: text(form, 'text_en'),
        text_pcm: text(form, 'text_pcm') || null,
      };
  try {
    await adminApi(routes.admin.banner(), { method: 'POST', body: { banner, reason: text(form, 'reason') } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/liveops');
  return { done: takeDown ? 'The banner is down.' : 'The banner is up.', error: null };
}

/** A game or economy value (step 2.7g): a new value, or back to the one before. */
export async function saveConfig(key: string, _state: FormState, form: FormData): Promise<FormState> {
  const rollback = form.get('intent') === 'rollback';
  try {
    if (rollback) {
      await adminApi(routes.admin.configRollback(key), {
        method: 'POST',
        body: { reason: text(form, 'reason') },
      });
    } else {
      await adminApi(routes.admin.configValue(key), {
        method: 'POST',
        body: { value: Number(text(form, 'value')), reason: text(form, 'reason') },
      });
    }
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/liveops');
  return { done: rollback ? 'Rolled back.' : 'Saved. Players get it within a minute.', error: null };
}
