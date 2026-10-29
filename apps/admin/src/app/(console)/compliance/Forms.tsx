'use client';
/** Compliance's forms (step 2.8a): log a request, export with a reason, erase with a reason. */
import { useActionState, useState } from 'react';
import { eraseUser, startDsar, type FormState } from './actions';

const IDLE: FormState = { done: null, error: null };

function Outcome({ state, testId }: { state: FormState; testId: string }) {
  if (state.error) {
    return (
      <span className="error" role="alert" data-testid={`${testId}-error`}>
        {state.error}
      </span>
    );
  }
  return state.done ? (
    <span className="ok" role="status" data-testid={`${testId}-done`}>
      {state.done}
    </span>
  ) : null;
}

export function StartDsar({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(startDsar.bind(null, userId), IDLE);
  return (
    <form action={action} className="stack" data-testid="start-dsar">
      <label>
        The player asked for
        <select name="kind" defaultValue="access" data-testid="dsar-kind">
          <option value="access">A copy of their data</option>
          <option value="erasure">Their account deleted</option>
        </select>
      </label>
      <label>
        How they asked, and when
        <input
          name="note"
          required
          minLength={3}
          maxLength={500}
          placeholder="Email to help@ on 28 Oct, ticket 1234"
          data-testid="dsar-note"
        />
      </label>
      <button type="submit" disabled={pending} data-testid="dsar-log">
        Log the request
      </button>
      <Outcome state={state} testId="dsar" />
    </form>
  );
}

export function ExportLink({ userId }: { userId: string }) {
  const [reason, setReason] = useState('');
  const href = `/compliance/export/${encodeURIComponent(userId)}?reason=${encodeURIComponent(reason)}`;
  return (
    <div className="inline">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason"
        aria-label="Reason for the export"
        data-testid={`export-reason-${userId}`}
      />
      {reason.trim().length >= 3 ? (
        <a className="button" href={href} download data-testid={`export-${userId}`}>
          Export
        </a>
      ) : (
        <button type="button" disabled>
          Export
        </button>
      )}
    </div>
  );
}

export function EraseForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(eraseUser.bind(null, userId), IDLE);
  return (
    <form action={action} className="inline" data-testid={`erase-${userId}`}>
      <input name="reason" required minLength={3} maxLength={300} placeholder="Reason" aria-label="Reason" />
      <input name="confirm" required placeholder="Type ERASE" aria-label="Type ERASE to confirm" />
      <button className="danger" type="submit" disabled={pending}>
        Erase now
      </button>
      <Outcome state={state} testId={`erase-${userId}`} />
    </form>
  );
}
