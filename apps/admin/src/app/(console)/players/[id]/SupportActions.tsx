'use client';
/**
 * Support's tools on User 360 (doc 18 §8): a staff note, and coin grants, streak restores and
 * signing a player out everywhere, each with a reason that goes in the audit log. The server
 * holds the limits (500 coins a player a day for support, 5,000 for admins).
 */
import { useActionState, useState } from 'react';
import { addNote, playerAction, type ActionState } from './actions';

const IDLE: ActionState = { done: null, error: null };

function Outcome({ state, testId }: { state: ActionState; testId: string }) {
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

export function NoteForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(addNote.bind(null, userId), IDLE);
  return (
    <form action={action} className="stack">
      <label>
        Add a note
        <textarea
          name="body"
          required
          maxLength={2000}
          rows={3}
          placeholder="What happened, what you did, ticket number"
          data-testid="note-body"
        />
      </label>
      <button type="submit" disabled={pending} data-testid="note-save">
        Save note
      </button>
      <Outcome state={state} testId="note" />
    </form>
  );
}

const ACTIONS = [
  { type: 'grant_coins', label: 'Grant coins' },
  { type: 'restore_streak', label: 'Restore the Daily streak' },
  { type: 'sign_out', label: 'Sign out everywhere' },
] as const;

export function SupportActions({ userId }: { userId: string }) {
  const [type, setType] = useState<(typeof ACTIONS)[number]['type']>('grant_coins');
  const [state, action, pending] = useActionState(playerAction.bind(null, userId), IDLE);
  return (
    <form action={action} className="stack" data-testid="support-actions">
      <fieldset className="choices">
        <legend>What do you need to do?</legend>
        {ACTIONS.map((a) => (
          <label key={a.type}>
            <input
              type="radio"
              name="type"
              value={a.type}
              checked={type === a.type}
              onChange={() => setType(a.type)}
              data-testid={`action-${a.type}`}
            />
            {a.label}
          </label>
        ))}
      </fieldset>
      {type === 'grant_coins' ? (
        <label>
          How many coins
          <input
            name="amount"
            type="number"
            min={1}
            max={5000}
            required
            defaultValue={100}
            data-testid="action-amount"
          />
        </label>
      ) : null}
      {type === 'restore_streak' ? (
        <p className="muted small">
          Brings back a streak that broke in the last 14 days. Once every 30 days.
        </p>
      ) : null}
      {type === 'sign_out' ? (
        <p className="muted small">Ends every session; open apps notice within 15 minutes.</p>
      ) : null}
      <label>
        Reason (goes in the audit log)
        <input
          name="reason"
          required
          minLength={3}
          maxLength={300}
          placeholder="Ticket number and why"
          data-testid="action-reason"
        />
      </label>
      <button className="primary" type="submit" disabled={pending} data-testid="action-confirm">
        {ACTIONS.find((a) => a.type === type)!.label}
      </button>
      <Outcome state={state} testId="action" />
    </form>
  );
}
