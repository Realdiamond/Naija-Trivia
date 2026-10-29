'use client';
/** The Daily scheduler's forms (step 2.7f): plan the next 30 days, and use another question. */
import { useActionState } from 'react';
import { planDailies, swapQuestion, type FormState } from './actions';

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

export function PlanForm() {
  const [state, action, pending] = useActionState(planDailies, IDLE);
  return (
    <form action={action} className="inline" data-testid="plan-form">
      <label>
        Reason
        <input
          name="reason"
          required
          minLength={3}
          maxLength={300}
          placeholder="e.g. Plan March"
          data-testid="plan-reason"
        />
      </label>
      <button className="primary" type="submit" disabled={pending} data-testid="plan">
        Plan the next 30 days
      </button>
      <Outcome state={state} testId="plan" />
    </form>
  );
}

export function UseInstead({ date, slot, questionId }: { date: string; slot: number; questionId: string }) {
  const [state, action, pending] = useActionState(swapQuestion.bind(null, date, slot, questionId), IDLE);
  return (
    <form action={action} className="inline" data-testid={`use-${questionId}`}>
      <input
        name="reason"
        required
        minLength={3}
        maxLength={300}
        placeholder="Why swap?"
        aria-label="Why swap?"
        data-testid={`use-reason-${questionId}`}
      />
      <button type="submit" disabled={pending} data-testid={`use-confirm-${questionId}`}>
        Use this one
      </button>
      <Outcome state={state} testId={`use-${questionId}`} />
    </form>
  );
}
