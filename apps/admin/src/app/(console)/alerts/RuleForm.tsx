'use client';
/** A new threshold alert rule (step 2.7m): what to watch, when to alert, over how long, and where to. */
import { useActionState } from 'react';
import { ALERT_METRICS, type AlertChannel } from '@whosabi/shared-types';
import { createRule, type FormState } from './actions';

const IDLE: FormState = { done: null, error: null };

const CHANNEL_LABELS: Record<AlertChannel, string> = {
  phone: 'Staff phones',
  email: 'Email',
  slack: 'Slack',
};

export function RuleForm({ channels }: { channels: Record<AlertChannel, boolean> }) {
  const [state, action, pending] = useActionState(createRule, IDLE);
  return (
    <form action={action} className="stack" data-testid="new-rule">
      <div className="field-grid">
        <label>
          Watch
          <select name="metric" defaultValue="otp_success">
            {Object.entries(ALERT_METRICS).map(([key, m]) => (
              <option key={key} value={key}>
                {m.label} ({m.unit})
              </option>
            ))}
          </select>
        </label>
        <label>
          Alert when it is
          <select name="comparison" defaultValue="below">
            <option value="below">below</option>
            <option value="above">above</option>
            <option value="drop_pct_vs_last_week">down this % on last week</option>
          </select>
        </label>
        <label>
          Line
          <input name="threshold" type="number" min={0} step="any" defaultValue={85} required />
        </label>
        <label>
          Over the last (minutes)
          <input name="window_minutes" type="number" min={5} max={1440} defaultValue={15} required />
        </label>
        <label>
          Name (optional)
          <input name="name" maxLength={80} placeholder="Sign-in codes failing" />
        </label>
      </div>
      <fieldset className="row">
        <legend className="small">Send to</legend>
        {(Object.keys(CHANNEL_LABELS) as AlertChannel[]).map((c) => (
          <label key={c} className="check">
            <input
              type="checkbox"
              name="channels"
              value={c}
              defaultChecked={c === 'phone'}
              disabled={!channels[c]}
            />
            {CHANNEL_LABELS[c]}
            {channels[c] ? null : <span className="muted small">(not set up)</span>}
          </label>
        ))}
      </fieldset>
      <div className="row">
        <button type="submit" disabled={pending} data-testid="add-rule">
          Add rule
        </button>
      </div>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.done ? (
        <p className="ok" role="status" data-testid="rule-added">
          {state.done}
        </p>
      ) : null}
    </form>
  );
}
