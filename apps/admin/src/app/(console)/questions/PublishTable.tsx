'use client';
/** Approved questions with tick boxes, so an editor publishes a checked batch at once. */
import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { AdminQuestionRow } from '@whosabi/shared-types';
import { CATEGORY_NAME } from '../../../lib/content';
import { publishMany, type FormState } from './actions';

export function PublishTable({ rows }: { rows: AdminQuestionRow[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [state, setState] = useState<FormState>({ message: null, error: false });
  const [pending, start] = useTransition();
  const all = rows.length > 0 && picked.size === rows.length;

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <div className="stack">
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={pending || picked.size === 0}
          onClick={() =>
            start(async () => {
              setState(await publishMany([...picked]));
              setPicked(new Set());
            })
          }
          data-testid="publish-selected"
        >
          Publish {picked.size || ''} selected
        </button>
        {state.message ? <span className={state.error ? 'error' : 'ok'}>{state.message}</span> : null}
      </div>
      <table>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                aria-label="Select all on this page"
                checked={all}
                onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.id)))}
              />
            </th>
            <th>Question</th>
            <th>Category</th>
            <th>Difficulty</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Select ${r.external_ref ?? r.id}`}
                  checked={picked.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
              </td>
              <td>
                <Link href={`/questions/${r.id}`}>{r.text}</Link>
                <div className="mono muted">{r.external_ref ?? r.id}</div>
              </td>
              <td>{CATEGORY_NAME[r.category_id] ?? r.category_id}</td>
              <td>{r.difficulty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
