'use client';
/** Keeps a trending question in the game for another 90 days (step 2.6b-3). */
import { useState, useTransition } from 'react';
import { renewQuestion, type FormState } from './actions';

export function RenewTrending({ id }: { id: string }) {
  const [state, setState] = useState<FormState>({ message: null, error: false });
  const [pending, start] = useTransition();
  return (
    <div className="row">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setState(await renewQuestion(id)))}
        data-testid="renew"
      >
        Renew for 90 days
      </button>
      {state.message ? <span className={state.error ? 'error' : 'ok'}>{state.message}</span> : null}
    </div>
  );
}
