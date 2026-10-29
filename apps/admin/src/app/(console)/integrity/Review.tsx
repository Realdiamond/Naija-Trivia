'use client';
/** Dismiss a flag, or mark it acted on after acting on User 360; either way with a note. */
import { useActionState } from 'react';
import { reviewFlag, type ReviewState } from './actions';

export function Review({ id }: { id: number }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewFlag.bind(null, id), {
    error: null,
  });
  return (
    <form action={action} className="inline" data-testid={`review-${id}`}>
      <label>
        Note
        <input name="note" required minLength={3} maxLength={500} data-testid={`note-${id}`} />
      </label>
      <button
        type="submit"
        name="decision"
        value="dismissed"
        disabled={pending}
        data-testid={`dismiss-${id}`}
      >
        Nothing in it
      </button>
      <button
        type="submit"
        name="decision"
        value="actioned"
        disabled={pending}
        data-testid={`actioned-${id}`}
      >
        Acted on
      </button>
      {state.error ? <span className="error">{state.error}</span> : null}
    </form>
  );
}
