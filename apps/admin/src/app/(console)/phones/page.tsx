/**
 * Staff phones (step 2.9a): phones signed in to the Staff tab in the app, for 30 days each.
 * Owners and admins see everyone's and can sign any of them out, for a lost phone or someone
 * leaving; anyone else sees their own.
 */
import type { AdminPhonesResponse } from '@whosabi/shared-types';
import { routes } from '@whosabi/shared-types';
import { adminApi } from '../../../lib/api';
import { watDateTime } from '../../../lib/format';
import { SignOutPhone } from './SignOutPhone';

export default async function PhonesPage() {
  const { phones } = await adminApi<AdminPhonesResponse>(routes.admin.phones());
  return (
    <>
      <h1>Staff phones</h1>
      <p className="muted">
        Phones signed in to staff tools in the app. Each stays signed in for 30 days and opens with its
        fingerprint or PIN. Sign out a phone that is lost or no longer used.
      </p>
      {phones.length === 0 ? (
        <p className="muted" data-testid="no-phones">
          No phones are signed in.
        </p>
      ) : (
        <table data-testid="phones">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Phone</th>
              <th>Signed in</th>
              <th>Last used</th>
              <th>Ends</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {phones.map((p) => (
              <tr key={p.id}>
                <td>{p.admin_name}</td>
                <td>{p.label}</td>
                <td>{watDateTime(p.created_at)}</td>
                <td>{watDateTime(p.last_used_at)}</td>
                <td>{watDateTime(p.expires_at)}</td>
                <td>
                  <SignOutPhone id={p.id} label={p.label} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
