'use server';
/** Staff and role changes (owners only). The API enforces the four-eyes rule and logs each change. */
import { revalidatePath } from 'next/cache';
import { AdminApiError, adminApi } from '../../../lib/api';

export interface StaffState {
  message: string | null;
  error: boolean;
}

async function run(work: () => Promise<unknown>, done: string): Promise<StaffState> {
  try {
    await work();
  } catch (e) {
    return { message: e instanceof AdminApiError ? e.message : 'That did not work.', error: true };
  }
  revalidatePath('/staff');
  return { message: done, error: false };
}

export async function addStaff(_state: StaffState, form: FormData): Promise<StaffState> {
  const email = String(form.get('email') ?? '');
  return run(
    () => adminApi('/admin/staff', { method: 'POST', body: { email, name: String(form.get('name') ?? '') } }),
    `${email} added. Grant them a role next.`,
  );
}

export async function grantRole(_state: StaffState, form: FormData): Promise<StaffState> {
  const id = String(form.get('id') ?? '');
  const role = String(form.get('role') ?? '');
  const expires = String(form.get('expires') ?? '');
  return run(
    () =>
      adminApi(`/admin/staff/${encodeURIComponent(id)}/roles`, {
        method: 'POST',
        body: {
          role,
          reason: String(form.get('reason') ?? ''),
          ...(expires ? { expires_at: new Date(`${expires}T23:59:59+01:00`).toISOString() } : {}),
        },
      }),
    `${role} granted.`,
  );
}

export async function approveRole(id: string, role: string): Promise<StaffState> {
  return run(
    () =>
      adminApi(`/admin/staff/${encodeURIComponent(id)}/roles/${encodeURIComponent(role)}/approve`, {
        method: 'POST',
      }),
    `${role} approved.`,
  );
}

export async function revokeRole(id: string, role: string): Promise<StaffState> {
  return run(
    () =>
      adminApi(`/admin/staff/${encodeURIComponent(id)}/roles/${encodeURIComponent(role)}`, {
        method: 'DELETE',
      }),
    `${role} removed.`,
  );
}
