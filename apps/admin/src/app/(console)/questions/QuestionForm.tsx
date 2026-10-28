'use client';
/**
 * The question editor (doc 04 §2): the Question Bible's limits as live counters, the right answer
 * marked beside its option. Saving checks everything again on the server.
 */
import { useActionState, useState } from 'react';
import type { AdminQuestionInput } from '@whosabi/shared-types';
import { CATEGORY_NAME, DIFFICULTY_LABEL } from '../../../lib/content';
import { saveQuestion, type FormState } from './actions';

const LIMITS = { text: 120, option: 30, fact: 160 };
const REGIONS = ['ALL', 'SW', 'SE', 'SS', 'N', 'NC'] as const;

const EMPTY: AdminQuestionInput = {
  category_id: 'slang',
  subcategory: null,
  type: 'mcq4',
  text: '',
  options: ['', '', '', ''],
  correct_index: 0,
  numeric_answer: null,
  fact: null,
  difficulty: 2,
  family_safe: true,
  region_tag: 'ALL',
  valid_until: null,
  source_url: null,
};

function Count({ value, limit }: { value: string; limit: number }) {
  return (
    <span className={value.length > limit ? 'count over' : 'count'}>
      {value.length} / {limit}
    </span>
  );
}

export function QuestionForm({ id, initial }: { id?: string; initial?: AdminQuestionInput }) {
  const start = initial ?? EMPTY;
  const [state, action, pending] = useActionState<FormState, FormData>(saveQuestion, {
    message: null,
    error: false,
  });
  const [type, setType] = useState(start.type);
  const [questionText, setQuestionText] = useState(start.text);
  const [fact, setFact] = useState(start.fact ?? '');
  const [options, setOptions] = useState<string[]>(() => {
    const filled = [...start.options];
    while (filled.length < 4) filled.push('');
    return filled;
  });
  const shown = type === 'mcq4' ? 4 : type === 'true_false' ? 2 : 0;

  const changeType = (next: AdminQuestionInput['type']) => {
    setType(next);
    if (next === 'true_false' && !options[0] && !options[1]) setOptions(['True', 'False', '', '']);
  };

  return (
    <form action={action} className="card stack" data-testid="question-form">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <div className="field-grid">
        <label>
          Category
          <select name="category_id" defaultValue={start.category_id}>
            {Object.entries(CATEGORY_NAME).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select
            name="type"
            value={type}
            onChange={(e) => changeType(e.target.value as AdminQuestionInput['type'])}
          >
            <option value="mcq4">Four options</option>
            <option value="true_false">True or false</option>
            <option value="closest_number">Closest number (duel tie-break)</option>
          </select>
        </label>
        <label>
          Difficulty
          <select name="difficulty" defaultValue={start.difficulty}>
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Question
        <textarea
          name="text"
          rows={2}
          required
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          data-testid="field-text"
        />
        <Count value={questionText} limit={LIMITS.text} />
      </label>

      {type === 'closest_number' ? (
        <label>
          The number that answers it
          <input name="numeric" type="number" step="any" required defaultValue={start.numeric_answer ?? ''} />
        </label>
      ) : (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small muted" style={{ marginBottom: 8 }}>
            Options: mark the right one. The game shuffles them for each player.
          </legend>
          {options.slice(0, shown).map((value, i) => (
            <div className="option" key={i}>
              <input
                type="radio"
                name="correct"
                value={i}
                defaultChecked={(start.correct_index ?? 0) === i}
                aria-label={`Option ${i + 1} is right`}
              />
              <label style={{ fontWeight: 600 }}>
                <input
                  name={`option${i}`}
                  value={value}
                  required
                  aria-label={`Option ${i + 1}`}
                  onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
                  data-testid={`field-option${i}`}
                />
                <Count value={value} limit={LIMITS.option} />
              </label>
            </div>
          ))}
        </fieldset>
      )}

      <label>
        &quot;Did you know?&quot; fact
        <textarea name="fact" rows={2} value={fact} onChange={(e) => setFact(e.target.value)} />
        <Count value={fact} limit={LIMITS.fact} />
      </label>

      <label>
        Source link (the page that confirms the fact)
        <input
          name="source_url"
          type="url"
          defaultValue={start.source_url ?? ''}
          placeholder="https://…"
          data-testid="field-source"
        />
      </label>

      <div className="field-grid">
        <label>
          Region
          <select name="region_tag" defaultValue={start.region_tag ?? ''}>
            <option value="">Not set</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          Subcategory (optional)
          <input name="subcategory" defaultValue={start.subcategory ?? ''} maxLength={40} />
        </label>
        <label>
          Valid until (for facts that change)
          <input name="valid_until" type="date" defaultValue={start.valid_until ?? ''} />
        </label>
      </div>

      <label className="check">
        <input type="checkbox" name="family_safe" defaultChecked={start.family_safe} /> Family-safe (13–17s
        can get it)
      </label>

      <div className="row">
        <button className="primary" type="submit" disabled={pending} data-testid="save-question">
          {id ? 'Save changes' : 'Save draft'}
        </button>
        {state.message ? <span className={state.error ? 'error' : 'ok'}>{state.message}</span> : null}
      </div>
    </form>
  );
}
