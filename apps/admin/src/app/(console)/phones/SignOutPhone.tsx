'use client';
import { useState, useTransition } from 'react';
import { signOutPhone } from './actions';

export function SignOutPhone({ id, label }: { id: string; label: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className="danger"
        disabled={pending}
        aria-label={`Sign out ${label}`}
        onClick={() => start(async () => setError((await signOutPhone(id)).error))}
        data-testid={`sign-out-${id}`}
      >
        Sign out
      </button>
      {error ? <span className="error small">{error}</span> : null}
    </>
  );
}
