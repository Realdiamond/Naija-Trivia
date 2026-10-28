'use client';
import { useActionState } from 'react';
import { devSignIn, type SignInState } from './actions';

/** Development and tests: sign in as a staff email without Google. */
export function DevSignIn() {
  const [state, action, pending] = useActionState<SignInState, FormData>(devSignIn, { error: null });
  return (
    <form action={action} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label>
        Staff email (development only)
        <input name="email" type="email" required autoComplete="email" data-testid="dev-email" />
      </label>
      <button className="primary" type="submit" disabled={pending} data-testid="dev-sign-in">
        Sign in
      </button>
      {state.error ? <p className="error">{state.error}</p> : null}
    </form>
  );
}
