'use client';
/**
 * The segment builder (step 2.7o): conditions that must all hold, counted before saving.
 * Each condition is one of doc 18 §9's properties or behaviours.
 */
import { useActionState, useState } from 'react';
import { NG_STATES, STATE_NAMES, type SegmentRule } from '@whosabi/shared-types';
import { askExport, countDraft, saveSegment, type FormState } from './actions';

const IDLE: FormState = { done: null, error: null };

const FIELDS: Array<[SegmentRule['field'], string, () => SegmentRule]> = [
  ['home_state', 'Home state is', () => ({ field: 'home_state', in: ['LA'] })],
  ['platform', 'Plays on', () => ({ field: 'platform', in: ['android'] })],
  ['age_band', 'Age band is', () => ({ field: 'age_band', in: ['18_plus'] })],
  ['account', 'Account', () => ({ field: 'account', is: 'signed_up' })],
  ['joined_within_days', 'Joined in the last', () => ({ field: 'joined_within_days', days: 7 })],
  ['active_within_days', 'Played in the last', () => ({ field: 'active_within_days', days: 7 })],
  ['inactive_for_days', 'Not played for', () => ({ field: 'inactive_for_days', days: 14 })],
  ['duels_finished', 'Duels finished', () => ({ field: 'duels_finished', min: 5, within_days: 7 })],
  ['purchased', 'Bought coins', () => ({ field: 'purchased', ever: false })],
  ['coins_at_least', 'Coins at least', () => ({ field: 'coins_at_least', n: 500 })],
  ['level_at_least', 'Level at least', () => ({ field: 'level_at_least', n: 5 })],
  ['streak_at_least', 'Daily streak at least', () => ({ field: 'streak_at_least', n: 3 })],
];

const num = (value: string) => Math.max(0, Math.floor(Number(value) || 0));

function RuleInputs({ rule, set }: { rule: SegmentRule; set: (rule: SegmentRule) => void }) {
  switch (rule.field) {
    case 'home_state':
      return (
        <select
          multiple
          aria-label="States"
          value={rule.in}
          onChange={(e) =>
            set({ ...rule, in: [...e.target.selectedOptions].map((o) => o.value) as typeof rule.in })
          }
        >
          {NG_STATES.map((s) => (
            <option key={s} value={s}>
              {STATE_NAMES[s]}
            </option>
          ))}
        </select>
      );
    case 'platform':
    case 'age_band': {
      const options = rule.field === 'platform' ? ['android', 'ios', 'web'] : ['13_17', '18_plus'];
      return (
        <span className="row">
          {options.map((o) => (
            <label key={o} className="check">
              <input
                type="checkbox"
                checked={(rule.in as string[]).includes(o)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...(rule.in as string[]), o]
                    : (rule.in as string[]).filter((x) => x !== o);
                  set({ ...rule, in: next } as SegmentRule);
                }}
              />
              {o}
            </label>
          ))}
        </span>
      );
    }
    case 'account':
      return (
        <select
          value={rule.is}
          onChange={(e) => set({ ...rule, is: e.target.value as 'guest' | 'signed_up' })}
        >
          <option value="signed_up">signed up</option>
          <option value="guest">a guest</option>
        </select>
      );
    case 'purchased':
      return (
        <select
          value={rule.ever ? 'yes' : 'no'}
          onChange={(e) => set({ ...rule, ever: e.target.value === 'yes' })}
        >
          <option value="no">never</option>
          <option value="yes">at least once</option>
        </select>
      );
    case 'duels_finished':
      return (
        <span className="row">
          at least
          <input
            type="number"
            min={0}
            value={rule.min}
            onChange={(e) => set({ ...rule, min: num(e.target.value) })}
          />
          in the last
          <input
            type="number"
            min={1}
            max={365}
            value={rule.within_days}
            onChange={(e) => set({ ...rule, within_days: Math.max(1, num(e.target.value)) })}
          />
          days
        </span>
      );
    case 'joined_within_days':
    case 'active_within_days':
    case 'inactive_for_days':
      return (
        <span className="row">
          <input
            type="number"
            min={1}
            max={365}
            value={rule.days}
            aria-label="Days"
            onChange={(e) => set({ ...rule, days: Math.max(1, num(e.target.value)) })}
          />
          days
        </span>
      );
    case 'coins_at_least':
    case 'level_at_least':
    case 'streak_at_least':
      return (
        <input
          type="number"
          min={0}
          value={rule.n}
          aria-label="At least"
          onChange={(e) => set({ ...rule, n: num(e.target.value) } as SegmentRule)}
        />
      );
  }
}

export function SegmentBuilder() {
  const [rules, setRules] = useState<SegmentRule[]>([FIELDS[0]![2]()]);
  const [counted, count, counting] = useActionState(countDraft, IDLE);
  const [saved, save, saving] = useActionState(saveSegment, IDLE);
  const definition = JSON.stringify({ rules });
  return (
    <div className="stack" data-testid="segment-builder">
      {rules.map((rule, i) => (
        <div key={i} className="row" data-testid={`rule-${i}`}>
          <select
            aria-label={`Condition ${i + 1}`}
            value={rule.field}
            onChange={(e) => {
              const make = FIELDS.find(([f]) => f === e.target.value)![2];
              setRules(rules.map((r, j) => (j === i ? make() : r)));
            }}
          >
            {FIELDS.map(([field, label]) => (
              <option key={field} value={field}>
                {label}
              </option>
            ))}
          </select>
          <RuleInputs rule={rule} set={(next) => setRules(rules.map((r, j) => (j === i ? next : r)))} />
          {rules.length > 1 ? (
            <button type="button" className="small" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
              Remove
            </button>
          ) : null}
        </div>
      ))}
      {rules.length < 10 ? (
        <div>
          <button type="button" onClick={() => setRules([...rules, FIELDS[1]![2]()])}>
            And another condition
          </button>
        </div>
      ) : null}
      <form action={count} className="row">
        <input type="hidden" name="definition" value={definition} />
        <button type="submit" disabled={counting} data-testid="count-segment">
          Count
        </button>
        {counted.done ? (
          <span className="ok" role="status" data-testid="segment-count">
            {counted.done}
          </span>
        ) : null}
        {counted.error ? <span className="error">{counted.error}</span> : null}
      </form>
      <form action={save} className="inline">
        <input type="hidden" name="definition" value={definition} />
        <label>
          Name
          <input name="name" required minLength={2} maxLength={80} placeholder="New in Lagos, never bought" />
        </label>
        <button type="submit" disabled={saving}>
          Save segment
        </button>
        {saved.done ? (
          <span className="ok" role="status" data-testid="segment-saved">
            {saved.done}
          </span>
        ) : null}
        {saved.error ? <span className="error">{saved.error}</span> : null}
      </form>
    </div>
  );
}

export function AskExport({ segmentId }: { segmentId: string }) {
  const [state, action, pending] = useActionState(askExport.bind(null, segmentId), IDLE);
  return (
    <form action={action} className="inline" data-testid={`ask-export-${segmentId}`}>
      <label>
        Why export it?
        <input name="reason" required minLength={10} maxLength={500} placeholder="Survey invitations" />
      </label>
      <button type="submit" disabled={pending}>
        Ask to export
      </button>
      {state.done ? <span className="ok">{state.done}</span> : null}
      {state.error ? <span className="error">{state.error}</span> : null}
    </form>
  );
}
