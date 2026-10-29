'use client';
/**
 * Moderators' tools on User 360 (doc 18 §8, doc 10 §2, step 2.7d): warn, take the username
 * away, hide from the boards, ban and lift a ban, each with a reason in the audit log. The
 * server holds the rules (bans over 30 days, or for good, need an admin).
 */
import { useActionState, useState } from 'react';
import type { AdminUserSummary } from '@whosabi/shared-types';
import { playerAction, type ActionState } from './actions';

const IDLE: ActionState = { done: null, error: null };

export function ModerationActions({ user }: { user: AdminUserSummary }) {
  const banned = user.status === 'banned';
  const actions = [
    { type: 'warn', label: 'Warn (they read it in the app)' },
    ...(user.username ? [{ type: 'rename', label: `Take "${user.username}" away` }] : []),
    user.hidden_from_boards
      ? { type: 'unrestrict', label: 'Put back on the boards' }
      : { type: 'shadow_restrict', label: 'Hide from the boards others see' },
    banned ? { type: 'unban', label: 'Lift the ban' } : { type: 'ban', label: 'Ban' },
  ];
  const [type, setType] = useState(actions[0]!.type);
  const [state, action, pending] = useActionState(playerAction.bind(null, user.id), IDLE);
  const chosen = actions.find((a) => a.type === type) ?? actions[0]!;
  return (
    <form action={action} className="stack" data-testid="moderation-actions">
      <fieldset className="choices">
        <legend>What do you need to do?</legend>
        {actions.map((a) => (
          <label key={a.type}>
            <input
              type="radio"
              name="type"
              value={a.type}
              checked={chosen.type === a.type}
              onChange={() => setType(a.type)}
              data-testid={`mod-${a.type}`}
            />
            {a.label}
          </label>
        ))}
      </fieldset>
      {chosen.type === 'warn' ? (
        <label>
          What the player reads
          <textarea
            name="message"
            required
            minLength={10}
            maxLength={500}
            rows={3}
            placeholder="Please keep party nicknames clean. Next time the account is suspended."
            data-testid="mod-message"
          />
        </label>
      ) : null}
      {chosen.type === 'ban' ? (
        <label>
          How long
          <select name="days" defaultValue="7" data-testid="mod-days">
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days (admins)</option>
            <option value="forever">For good (admins)</option>
          </select>
        </label>
      ) : null}
      {chosen.type === 'ban' ? (
        <p className="muted small">They are signed out everywhere and told when it ends and how to appeal.</p>
      ) : null}
      <label>
        Reason (goes in the audit log)
        <input
          name="reason"
          required
          minLength={3}
          maxLength={300}
          placeholder="Report or flag number, and why"
          data-testid="mod-reason"
        />
      </label>
      <button className="primary" type="submit" disabled={pending} data-testid="mod-confirm">
        {chosen.label.replace(/ \(.*\)$/, '')}
      </button>
      {state.error ? (
        <p className="error" role="alert" data-testid="mod-error">
          {state.error}
        </p>
      ) : state.done ? (
        <p className="ok" role="status" data-testid="mod-done">
          {state.done}
        </p>
      ) : null}
    </form>
  );
}
