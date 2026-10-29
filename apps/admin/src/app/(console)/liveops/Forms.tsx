'use client';
/**
 * The LiveOps forms (step 2.7c): one per flag (on or off, and who gets it), and the status
 * banner. Every change needs a reason; apps pick it up within a minute.
 */
import { useActionState } from 'react';
import type { AdminFlag, StatusBanner } from '@whosabi/shared-types';
import { saveBanner, saveFlag, type FormState } from './actions';

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
