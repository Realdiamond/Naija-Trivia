'use server';
/**
 * LiveOps changes: a flag or kill switch and the status banner (step 2.7c), game and economy
 * values (step 2.7g), Home banners and events (step 2.7h), and experiments (step 2.7s). The API
 * checks who may.
 */
import { revalidatePath } from 'next/cache';
import {
  routes,
  type AdminExperimentInput,
  type AdminFlagRule,
  type AdminFlagUpdate,
  type AdminLiveEventCreate,
  type StatusBanner,
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

/** A time typed in the console's date and time box, in Lagos time (WAT, UTC+1). */
const fromWat = (value: string) => new Date(`${value}:00+01:00`).toISOString();

export async function scheduleEvent(_state: FormState, form: FormData): Promise<FormState> {
  const kind = text(form, 'kind') === 'double_xp' ? 'double_xp' : 'banner';
  const platform = text(form, 'platform');
  const body: AdminLiveEventCreate = {
    kind,
    title_en: text(form, 'title_en'),
    title_pcm: text(form, 'title_pcm') || null,
    body_en: text(form, 'body_en') || null,
    body_pcm: text(form, 'body_pcm') || null,
    action: (text(form, 'action') || null) as AdminLiveEventCreate['action'],
    category_id: kind === 'double_xp' ? text(form, 'category_id') || null : null,
    platforms: platform === 'android' || platform === 'ios' || platform === 'web' ? [platform] : null,
    starts_at: '',
    ends_at: '',
    reason: text(form, 'reason'),
  };
  try {
    body.starts_at = fromWat(text(form, 'starts_at'));
    body.ends_at = fromWat(text(form, 'ends_at'));
  } catch {
    return { done: null, error: 'Pick when it starts and when it ends.' };
  }
  try {
    await adminApi(routes.admin.events(), { method: 'POST', body });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/liveops');
  return { done: 'Scheduled.', error: null };
}

export async function endEvent(id: number, _state: FormState, form: FormData): Promise<FormState> {
  try {
    await adminApi(routes.admin.eventEnd(id), { method: 'POST', body: { reason: text(form, 'reason') } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/liveops');
  return { done: 'Ended.', error: null };
}

/** 'control:50, twelve:50' → the variants; a missing weight counts as 1. */
function variantsFrom(value: string): AdminExperimentInput['variants'] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [key = '', weight] = part.split(':').map((x) => x.trim());
      return { key, weight: weight ? Number(weight) : 1 };
    });
}

/** Writes down an experiment, or changes one that hasn't started (step 2.7s). */
export async function saveExperiment(_state: FormState, form: FormData): Promise<FormState> {
  const platform = text(form, 'platform');
  const body: AdminExperimentInput = {
    key: text(form, 'key'),
    description: text(form, 'description'),
    hypothesis: text(form, 'hypothesis'),
    variants: variantsFrom(text(form, 'variants')),
    audience: {
      ...(platform === 'android' || platform === 'ios' || platform === 'web'
        ? { platforms: [platform] }
        : {}),
      ...(text(form, 'min_app_version') ? { min_app_version: text(form, 'min_app_version') } : {}),
      percent: Number(text(form, 'percent') || 100),
    },
    primary_metric: text(form, 'primary_metric'),
    guardrails: text(form, 'guardrails')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean),
  };
  try {
    await adminApi(routes.admin.experiments(), { method: 'POST', body });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/liveops');
  return { done: 'Saved as a draft. Start it when it is ready.', error: null };
}

export async function moveExperiment(
  key: string,
  action: 'start' | 'stop',
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    await adminApi(routes.admin.experiment(key), {
      method: 'POST',
      body: { action, reason: text(form, 'reason') },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath('/liveops');
  return { done: action === 'start' ? 'Running. Players get it within a minute.' : 'Stopped.', error: null };
}
