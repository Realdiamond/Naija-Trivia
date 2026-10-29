'use client';
/**
 * The LiveOps forms (step 2.7c): one per flag (on or off, and who gets it), the status banner,
 * game and economy values (step 2.7g), and Home banners and events (step 2.7h). Every change
 * needs a reason; apps pick it up within a minute.
 */
import { useActionState, useState } from 'react';
import type { AdminConfigValue, AdminFlag, StatusBanner } from '@whosabi/shared-types';
import { CATEGORY_NAME } from '../../../lib/content';
import { endEvent, saveBanner, saveConfig, saveFlag, scheduleEvent, type FormState } from './actions';

const IDLE: FormState = { done: null, error: null };

function Outcome({ state, testId }: { state: FormState; testId: string }) {
  if (state.error) {
    return (
      <p className="error" role="alert" data-testid={`${testId}-error`}>
        {state.error}
      </p>
    );
  }
  return state.done ? (
    <p className="ok" role="status" data-testid={`${testId}-done`}>
      {state.done}
    </p>
  ) : null;
}

export function FlagForm({ flag }: { flag: AdminFlag }) {
  const [state, action, pending] = useActionState(saveFlag.bind(null, flag.key), IDLE);
  const rule = flag.rules[0] ?? {};
  const id = flag.key.replaceAll('.', '-');
  return (
    <form action={action} className="stack" data-testid={`flag-${id}`}>
      <label className="check">
        <input type="checkbox" name="enabled" defaultChecked={flag.enabled} data-testid={`flag-${id}-on`} />
        On
      </label>
      <div className="field-grid">
        <label>
          Platform
          <select name="platform" defaultValue={rule.platform ?? ''}>
            <option value="">Every platform</option>
            <option value="android">Android</option>
            <option value="ios">iPhone</option>
            <option value="web">Web</option>
          </select>
        </label>
        <label>
          From app version
          <input name="min_app_version" placeholder="e.g. 1.2.0" defaultValue={rule.min_app_version ?? ''} />
        </label>
        <label>
          Share of players (%)
          <input
            name="percent"
            type="number"
            min={0}
            max={100}
            placeholder="All"
            defaultValue={rule.percent ?? ''}
          />
        </label>
      </div>
      <label>
        Reason (goes in the audit log)
        <input name="reason" required minLength={3} maxLength={300} data-testid={`flag-${id}-reason`} />
      </label>
      <button className="primary" type="submit" disabled={pending} data-testid={`flag-${id}-save`}>
        Save
      </button>
      <Outcome state={state} testId={`flag-${id}`} />
    </form>
  );
}

export function BannerForm({ banner }: { banner: StatusBanner | null }) {
  const [state, action, pending] = useActionState(saveBanner, IDLE);
  return (
    <form action={action} className="stack" data-testid="banner-form">
      <label>
        Kind
        <select name="level" defaultValue={banner?.level ?? 'warning'}>
          <option value="warning">Problem players can see</option>
          <option value="info">News</option>
        </select>
      </label>
      <label>
        In English
        <input
          name="text_en"
          maxLength={160}
          defaultValue={banner?.text_en ?? ''}
          placeholder="Party rooms are having issues. Duels still work."
          data-testid="banner-en"
        />
      </label>
      <label>
        In Pidgin (optional)
        <input
          name="text_pcm"
          maxLength={160}
          defaultValue={banner?.text_pcm ?? ''}
          data-testid="banner-pcm"
        />
      </label>
      <label>
        Reason (goes in the audit log)
        <input name="reason" required minLength={3} maxLength={300} data-testid="banner-reason" />
      </label>
      <div className="row">
        <button
          className="primary"
          type="submit"
          name="intent"
          value="set"
          disabled={pending}
          data-testid="banner-set"
        >
          {banner ? 'Change the banner' : 'Put the banner up'}
        </button>
        {banner ? (
          <button type="submit" name="intent" value="clear" disabled={pending} data-testid="banner-clear">
            Take it down
          </button>
        ) : null}
      </div>
      <Outcome state={state} testId="banner" />
    </form>
  );
}

export function ConfigForm({ value }: { value: AdminConfigValue }) {
  const [state, action, pending] = useActionState(saveConfig.bind(null, value.key), IDLE);
  const id = value.key.replaceAll('.', '-');
  return (
    <form action={action} className="inline" data-testid={`config-${id}`}>
      <label>
        New value ({value.min}–{value.max})
        <input
          name="value"
          type="number"
          min={value.min}
          max={value.max}
          defaultValue={value.value}
          required
          data-testid={`config-${id}-value`}
        />
      </label>
      <label>
        Reason
        <input name="reason" required minLength={3} maxLength={300} data-testid={`config-${id}-reason`} />
      </label>
      <button
        className="primary"
        type="submit"
        name="intent"
        value="set"
        disabled={pending}
        data-testid={`config-${id}-save`}
      >
        Save
      </button>
      {value.changed_by ? (
        <button
          type="submit"
          name="intent"
          value="rollback"
          disabled={pending}
          data-testid={`config-${id}-rollback`}
        >
          Roll back
        </button>
      ) : null}
      <Outcome state={state} testId={`config-${id}`} />
    </form>
  );
}

const ACTIONS: Record<string, string> = {
  daily: "Today's Daily",
  random: 'A random duel',
  party: 'Party rooms',
  challenge: 'Challenge a friend',
  leaderboards: 'Leaderboards',
  shop: 'The shop',
  friends: 'Friends',
};

export function EventForm() {
  const [state, action, pending] = useActionState(scheduleEvent, IDLE);
  const [kind, setKind] = useState<'banner' | 'double_xp'>('banner');
  return (
    <form action={action} className="stack" data-testid="event-form">
      <div className="field-grid">
        <label>
          Kind
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value === 'double_xp' ? 'double_xp' : 'banner')}
            data-testid="event-kind"
          >
            <option value="banner">Home banner</option>
            <option value="double_xp">Weekend Wahala: double XP in duels</option>
          </select>
        </label>
        {kind === 'double_xp' ? (
          <label>
            Category
            <select name="category_id" defaultValue="" data-testid="event-category">
              <option value="">Every category</option>
              {Object.entries(CATEGORY_NAME).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Platform
          <select name="platform" defaultValue="">
            <option value="">Every platform</option>
            <option value="android">Android</option>
            <option value="ios">iPhone</option>
            <option value="web">Web</option>
          </select>
        </label>
      </div>
      <label>
        Title in English
        <input name="title_en" required minLength={3} maxLength={60} data-testid="event-title" />
      </label>
      <label>
        Title in Pidgin (optional)
        <input name="title_pcm" minLength={3} maxLength={60} />
      </label>
      <label>
        Line under it in English (optional)
        <input name="body_en" minLength={3} maxLength={160} data-testid="event-body" />
      </label>
      <label>
        Line under it in Pidgin (optional)
        <input name="body_pcm" minLength={3} maxLength={160} />
      </label>
      <div className="field-grid">
        <label>
          Tapping it opens
          <select name="action" defaultValue="" data-testid="event-action">
            <option value="">Nothing</option>
            {Object.entries(ACTIONS).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Starts (WAT)
          <input name="starts_at" type="datetime-local" required data-testid="event-starts" />
        </label>
        <label>
          Ends (WAT)
          <input name="ends_at" type="datetime-local" required data-testid="event-ends" />
        </label>
      </div>
      <label>
        Reason (goes in the audit log)
        <input name="reason" required minLength={3} maxLength={300} data-testid="event-reason" />
      </label>
      <button className="primary" type="submit" disabled={pending} data-testid="event-save">
        Schedule
      </button>
      <Outcome state={state} testId="event" />
    </form>
  );
}

export function EndEventForm({ id }: { id: number }) {
  const [state, action, pending] = useActionState(endEvent.bind(null, id), IDLE);
  return (
    <form action={action} className="inline" data-testid={`event-end-${id}`}>
      <input name="reason" required minLength={3} maxLength={300} placeholder="Reason" aria-label="Reason" />
      <button type="submit" disabled={pending}>
        End now
      </button>
      <Outcome state={state} testId={`event-end-${id}`} />
    </form>
  );
}
