'use client';
/** The workflow buttons this staff member may use now, with an optional note (required to send back). */
import { useState, useTransition } from 'react';
import type { QuestionAction } from '@whosabi/shared-types';
import { ACTION_LABEL } from '../../../lib/content';
import { moveQuestion, type FormState } from './actions';

const DANGER: readonly QuestionAction[] = ['retire', 'suspend', 'send_back'];

export function QuestionActions({ id, actions }: { id: string; actions: QuestionAction[] }) {
  const [note, setNote] = useState('');
  const [state, setState] = useState<FormState>({ message: null, error: false });
  const [pending, start] = useTransition();
  if (actions.length === 0) return <p className="muted small">Nothing for you to do on this question now.</p>;

  const run = (action: QuestionAction) =>
    start(async () => {
      if (action === 'send_back' && !note.trim()) {
        setState({ message: 'Write a note saying what needs fixing.', error: true });
        return;
      }
      const result = await moveQuestion(id, action, note);
      setState(result);
      if (!result.error) setNote('');
    });

  return (
    <div className="stack">
      <label>
        Note (optional; needed to send back)
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="row">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            className={DANGER.includes(action) ? 'danger' : 'primary'}
            disabled={pending}
            onClick={() => run(action)}
            data-testid={`action-${action}`}
          >
            {ACTION_LABEL[action]}
          </button>
        ))}
      </div>
      {state.message ? <p className={state.error ? 'error' : 'ok'}>{state.message}</p> : null}
    </div>
  );
}
