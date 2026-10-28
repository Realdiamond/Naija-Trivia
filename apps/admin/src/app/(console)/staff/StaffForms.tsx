'use client';
import { useActionState, useTransition, useState } from 'react';
import { AdminRole, PRIVILEGED_ROLES } from '@whosabi/shared-types';
import { addStaff, approveRole, grantRole, revokeRole, type StaffState } from './actions';

const initial: StaffState = { message: null, error: false };

function Message({ state }: { state: StaffState }) {
  if (!state.message) return null;
  return <p className={state.error ? 'error' : 'ok'}>{state.message}</p>;
}

export function AddStaffForm() {
  const [state, action, pending] = useActionState(addStaff, initial);
  return (
    <form action={action} className="inline">
      <label>
        Google account email
        <input name="email" type="email" required />
      </label>
      <label>
        Name
        <input name="name" required maxLength={100} />
      </label>
      <button className="primary" type="submit" disabled={pending}>
        Add to staff
      </button>
      <Message state={state} />
    </form>
  );
}

export function GrantRoleForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(grantRole, initial);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <label>
        Role
        <select name="role" required defaultValue="support">
          {AdminRole.options.map((role) => (
            <option key={role} value={role}>
              {role}
              {PRIVILEGED_ROLES.includes(role) ? ' (needs a second owner)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reason
        <input name="reason" required minLength={5} maxLength={500} />
      </label>
      <label>
        Ends (optional)
        <input name="expires" type="date" />
      </label>
      <button type="submit" disabled={pending}>
        Grant
      </button>
      <Message state={state} />
    </form>
  );
}

export function GrantActions({ id, role, canApprove }: { id: string; role: string; canApprove: boolean }) {
  const [state, setState] = useState<StaffState>(initial);
  const [pending, start] = useTransition();
  const act = (work: () => Promise<StaffState>) => start(async () => setState(await work()));
  return (
    <span className="row">
      {canApprove ? (
        <button type="button" disabled={pending} onClick={() => act(() => approveRole(id, role))}>
          Approve
        </button>
      ) : null}
      <button
        type="button"
        className="danger"
        disabled={pending}
        onClick={() => act(() => revokeRole(id, role))}
      >
        Remove
      </button>
      <Message state={state} />
    </span>
  );
}
