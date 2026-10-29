/** The signed-in console: the top bar with search, and the sections this staff member may use. */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ANALYTICS_BOARD_PERMISSION, ANALYTICS_BOARDS, type AdminProfile } from '@whosabi/shared-types';
import { adminApi } from '../../lib/api';
import { signOut } from '../login/actions';
import { NavLinks } from './NavLinks';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const me = await adminApi<AdminProfile>('/admin/me');
  const links = [
    ...(me.permissions.includes('overview.view')
      ? [
          { href: '/overview', label: 'Overview' },
          { href: '/live', label: 'Live' },
        ]
      : []),
    ...(ANALYTICS_BOARDS.some((b) => me.permissions.includes(ANALYTICS_BOARD_PERMISSION[b]))
      ? [{ href: '/analytics', label: 'Analytics' }]
      : []),
    ...(me.permissions.includes('segments.manage') ? [{ href: '/segments', label: 'Segments' }] : []),
    ...(me.permissions.includes('players.search') ? [{ href: '/players', label: 'Players' }] : []),
    ...(me.permissions.includes('players.moderate') ? [{ href: '/integrity', label: 'Integrity' }] : []),
    ...(me.permissions.includes('liveops.daily') ? [{ href: '/daily', label: 'Daily' }] : []),
    ...(me.permissions.includes('liveops.flags') || me.permissions.includes('liveops.config')
      ? [{ href: '/liveops', label: 'LiveOps' }]
      : []),
    ...(me.permissions.includes('content.view')
      ? [
          { href: '/questions', label: 'Questions' },
          { href: '/packs', label: 'Packs' },
          { href: '/reports', label: 'Reports' },
        ]
      : []),
    ...(me.permissions.includes('content.import') ? [{ href: '/import', label: 'Import' }] : []),
    ...(me.permissions.includes('commerce.view') ? [{ href: '/commerce', label: 'Commerce' }] : []),
    ...(me.permissions.includes('compliance.view') ? [{ href: '/compliance', label: 'Compliance' }] : []),
    ...(me.permissions.includes('audit.view') ? [{ href: '/audit', label: 'Audit log' }] : []),
    ...(me.permissions.includes('staff.manage') ? [{ href: '/staff', label: 'Staff and roles' }] : []),
    ...(me.permissions.includes('alerts.manage') ? [{ href: '/alerts', label: 'Alert rules' }] : []),
    { href: '/phones', label: 'Staff phones' },
  ];
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/">
          Who Sabi? <span>Admin</span>
        </Link>
        {me.permissions.includes('players.search') ? (
          <form className="search" action="/players" role="search">
            <input
              name="q"
              aria-label="Search players"
              placeholder="Username, user ID, phone, device ID or duel ID"
              data-testid="search"
            />
          </form>
        ) : null}
        <div className="who">
          <span data-testid="staff-name">
            {me.name} · {me.roles.join(', ') || 'no roles'}
          </span>
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </header>
      <div className="shell">
        <NavLinks links={links} />
        <main className="main">{children}</main>
      </div>
    </>
  );
}
