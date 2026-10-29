/** The console's front door: the first section this staff member's roles open. */
import { redirect } from 'next/navigation';
import type { AdminProfile } from '@whosabi/shared-types';
import { adminApi } from '../../lib/api';

export default async function ConsoleHome() {
  const me = await adminApi<AdminProfile>('/admin/me');
  if (me.permissions.includes('overview.view')) redirect('/overview');
  if (me.permissions.includes('players.search')) redirect('/players');
  if (me.permissions.includes('content.view')) redirect('/questions');
  if (me.permissions.includes('audit.view')) redirect('/audit');
  return (
    <>
      <h1>Welcome</h1>
      <p className="muted">Your account has no roles yet. Ask an owner to give you one on Staff and roles.</p>
    </>
  );
}
