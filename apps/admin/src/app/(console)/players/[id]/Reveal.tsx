'use client';
import { useActionState, useState } from 'react';
import { reveal, type RevealState } from './actions';

export function Reveal({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<RevealState, FormData>(reveal.bind(null, userId), {
    value: null,
    error: null,
  });
  if (state.value) {
    return (
      <span className="badge warn mono" data-testid="revealed">
        {state.value}
      </span>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid="reveal">
        Reveal (needs a reason)
      </button>
    );
  }
  return (
    <form action={action} className="inline">
      <label>
        Why do you need the full number?
        <input
          name="reason"
          required
          minLength={5}
          maxLength={500}
          placeholder="Ticket number and what for"
          data-testid="reveal-reason"
        />
      </label>
      <button className="primary" type="submit" disabled={pending} data-testid="reveal-confirm">
        Reveal and log it
      </button>
      {state.error ? <span className="error">{state.error}</span> : null}
    </form>
  );
}
