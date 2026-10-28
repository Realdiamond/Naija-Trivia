/**
 * Staff and roles (doc 18 §3): owners add staff and grant roles. Owner, admin, finance and DPO
 * need a second owner's approval before they work, and nobody approves their own grant.
 */
import type { AdminProfile, AdminStaffResponse } from '@whosabi/shared-types';
import { PRIVILEGED_ROLES } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { watDateTime } from '../../../lib/format';
import { AddStaffForm, GrantActions, GrantRoleForm } from './StaffForms';

export default async function Staff() {
  let data: AdminStaffResponse;
  let me: AdminProfile;
  try {
    [data, me] = await Promise.all([
      adminApi<AdminStaffResponse>('/admin/staff'),
      adminApi<AdminProfile>('/admin/me'),
    ]);
  } catch (e) {
    return (
      <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load the staff list.'}</p>
    );
  }
  return (
    <>
      <h1>Staff and roles</h1>
      <section className="card">
        <h2>Add someone</h2>
        <p className="muted small">
          They sign in with this Google account. Leavers lose access by removing their roles.
        </p>
        <AddStaffForm />
      </section>
      {data.staff.map((member) => (
        <section key={member.id} className="card" data-testid={`staff-${member.email}`}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <h2>{member.name}</h2>
              <span className="muted">
                {member.email} · last signed in {watDateTime(member.last_login_at)}
              </span>
            </div>
            <span className={member.status === 'active' ? 'badge' : 'badge off'}>{member.status}</span>
          </div>
          <table>
            <tbody>
              {member.grants.map((grant) => (
                <tr key={grant.role}>
                  <th scope="row">{grant.role}</th>
                  <td>
                    {grant.active ? (
                      <span className="badge">active</span>
                    ) : (
                      <span className="badge warn">waiting for a second owner</span>
                    )}
                    {grant.expires_at ? (
                      <span className="muted small"> · ends {watDateTime(grant.expires_at)}</span>
                    ) : null}
                  </td>
                  <td>
                    <GrantActions
                      id={member.id}
                      role={grant.role}
                      canApprove={
                        !grant.active &&
                        PRIVILEGED_ROLES.includes(grant.role) &&
                        !grant.approved_by &&
                        grant.granted_by !== me.id &&
                        member.id !== me.id
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <GrantRoleForm id={member.id} />
        </section>
      ))}
    </>
  );
}
