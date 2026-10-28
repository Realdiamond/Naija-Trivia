'use client';
/** Close a question's open reports: fixed (after editing it), nothing wrong, or retire it. */
import { useState, useTransition } from 'react';
import { resolveReports, type FormState } from '../questions/actions';

export function ResolveReports({ id }: { id: string }) {
  const [note, setNote] = useState('');
  const [state, setState] = useState<FormState>({ message: null, error: false });
  const [pending, start] = useTransition();
  const run = (resolution: 'fixed' | 'rejected' | 'retired') =>
    start(async () => setState(await resolveReports(id, resolution, note)));
  return (
    <div className="stack">
      <input
        aria-label="Note for the history"
        placeholder="Note for the history (optional)"
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="row">
        <button type="button" disabled={pending} onClick={() => run('rejected')} data-testid={`keep-${id}`}>
          Nothing wrong, keep it
        </button>
        <button type="button" disabled={pending} onClick={() => run('fixed')}>
          I fixed it
        </button>
        <button type="button" className="danger" disabled={pending} onClick={() => run('retired')}>
          Retire it
        </button>
      </div>
      {state.message ? <p className={state.error ? 'error' : 'ok'}>{state.message}</p> : null}
    </div>
  );
}
