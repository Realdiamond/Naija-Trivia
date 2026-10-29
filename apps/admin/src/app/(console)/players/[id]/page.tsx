/**
 * User 360 (doc 18 §7.2, mockup 32): who the player is, their activity timeline grouped into
 * sessions, time spent, matches, money, devices and consent, support's notes and actions
 * (step 2.7b), and every staff look at them. Opening this page, and each tab, is itself logged.
 */
import Link from 'next/link';
import type {
  AdminAuditResponse,
  AdminProfile,
  AdminTimelineResponse,
  AdminUserSummary,
} from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../../lib/api';
import { describeEvent, duration, groupSessions, watDateTime, watTime } from '../../../../lib/format';
import { Reveal } from './Reveal';
import { DevicesTab, MatchesTab, MoneyTab, SafetyTab, SessionsTab, SupportTab } from './tabs';

type Tab =
  'summary' | 'timeline' | 'sessions' | 'matches' | 'money' | 'safety' | 'devices' | 'support' | 'history';

export default async function User360({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; before?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam, before } = await searchParams;
  const me = await adminApi<AdminProfile>('/admin/me');
  const tabs: Array<[Tab, string]> = [
    ['summary', 'Summary'],
    ['timeline', 'Timeline'],
    ['sessions', 'Sessions & time'],
    ['matches', 'Matches'],
    ['money', 'Money'],
    ['safety', 'Safety'],
    ['devices', 'Devices & consent'],
    ['support', 'Support'],
    ...(me.permissions.includes('audit.view')
      ? ([['history', 'Admin history']] as Array<[Tab, string]>)
      : []),
  ];
  const tab: Tab = tabs.some(([t]) => t === tabParam) ? (tabParam as Tab) : 'summary';

  let user: AdminUserSummary;
  try {
    user = await adminApi<AdminUserSummary>(`/admin/users/${encodeURIComponent(id)}`);
  } catch (e) {
    return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load this player.'}</p>;
  }
  const phone = user.sign_in_methods.find((m) => m.provider === 'phone');
  const others = user.sign_in_methods.filter((m) => m.provider !== 'phone');

  return (
    <>
      <p className="small">
        <Link href="/players">Players</Link> › {user.username ?? 'Guest'}
      </p>
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row">
          <h1 data-testid="player-name">{user.username ?? 'Guest'}</h1>
          <span className={user.status === 'banned' ? 'badge warn' : 'badge'} data-testid="player-status">
            {user.status === 'banned'
              ? user.banned_until
                ? `banned until ${watDateTime(user.banned_until)}`
                : 'banned for good'
              : user.status}
          </span>
          {user.hidden_from_boards ? <span className="badge warn">hidden from boards</span> : null}
          {user.age_band ? (
            <span className="badge off">{user.age_band === '18_plus' ? '18+' : '13–17'}</span>
          ) : null}
          <span className="mono muted">{user.id}</span>
        </div>
        <p className="muted">
          {user.home_state ? `${user.home_state} · ` : ''}joined {watDateTime(user.created_at)}
          {user.signup_platform ? ` on ${user.signup_platform}` : ''}
          {user.acquisition_source ? ` from ${user.acquisition_source}` : ''} · last seen{' '}
          {watDateTime(user.last_seen_at)}
          {user.last_platform ? ` on ${user.last_platform}` : ''}
        </p>
        <div className="row">
          {phone ? (
            <>
              <span>
                Phone{' '}
                <span className="mono" data-testid="masked-phone">
                  {phone.masked}
                </span>
              </span>
              {me.permissions.includes('pii.reveal') ? <Reveal userId={user.id} /> : null}
            </>
          ) : (
            <span className="muted">No phone number</span>
          )}
          {others.map((m) => (
            <span key={`${m.provider}-${m.created_at}`} className="muted">
              · {m.provider === 'email' ? `Email ${m.masked}` : m.masked}
            </span>
          ))}
        </div>
      </section>

      <div className="tiles" data-testid="player-tiles">
        <Tile label="Level" value={String(user.level)} />
        <Tile label="Tier" value={`${user.tier.name} · ${user.rating.toLocaleString('en-NG')}`} />
        <Tile label="Coins" value={user.coins.toLocaleString('en-NG')} />
        <Tile label="Daily streak" value={`${user.streak.current} (best ${user.streak.best})`} />
        <Tile label="Lifetime spend" value={`₦${user.lifetime_spend_ngn.toLocaleString('en-NG')}`} />
        <Tile label="Friends" value={String(user.friends)} />
        <Tile label="Duels active" value={String(user.duels.active)} />
        <Tile
          label="Won / lost / drawn"
          value={`${user.duels.won} / ${user.duels.lost} / ${user.duels.drawn}`}
        />
      </div>

      <nav className="tabs" aria-label="Player">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`/players/${user.id}?tab=${key}`}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === 'summary' ? <Summary user={user} /> : null}
      {tab === 'timeline' ? <Timeline userId={user.id} before={before} /> : null}
      {tab === 'sessions' ? <SessionsTab userId={user.id} /> : null}
      {tab === 'matches' ? <MatchesTab userId={user.id} /> : null}
      {tab === 'money' ? <MoneyTab userId={user.id} /> : null}
      {tab === 'safety' ? (
        <SafetyTab user={user} canModerate={me.permissions.includes('players.moderate')} />
      ) : null}
      {tab === 'devices' ? <DevicesTab user={user} /> : null}
      {tab === 'support' ? (
        <SupportTab
          userId={user.id}
          canAct={me.permissions.includes('players.support')}
          canLogDsar={
            me.permissions.includes('players.support') || me.permissions.includes('compliance.view')
          }
        />
      ) : null}
      {tab === 'history' ? <History userId={user.id} /> : null}
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <span className="muted small">{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Summary({ user }: { user: AdminUserSummary }) {
  const rows: Array<[string, string]> = [
    ['XP', user.xp.toLocaleString('en-NG')],
    ['Gems', user.gems.toLocaleString('en-NG')],
    ['Language', user.language],
    ['Family mode', user.family_mode ? 'On' : 'Off'],
    ['Findable from contacts', user.discoverable ? 'Yes' : 'No'],
    ['Sign-in methods', user.sign_in_methods.map((m) => m.masked).join(', ') || 'None'],
    ['Guest accounts merged in', user.merged_guests.join(', ') || 'None'],
  ];
  return (
    <div className="grid2">
      <section className="card">
        <h2>Profile and settings</h2>
        <table>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Needs a look?</h2>
        <table>
          <tbody>
            <tr>
              <th scope="row">Open integrity flags</th>
              <td>{user.open_flags}</td>
            </tr>
            <tr>
              <th scope="row">Staff notes</th>
              <td>
                <Link href={`/players/${user.id}?tab=support`}>{user.notes}</Link>
              </td>
            </tr>
            <tr>
              <th scope="row">Daily streak</th>
              <td>
                {user.streak.current}
                {user.streak.last_play_date ? (
                  <div className="muted small">last Daily {user.streak.last_play_date}</div>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

async function Timeline({ userId, before }: { userId: string; before?: string }) {
  const query = new URLSearchParams({ limit: '200', ...(before ? { before } : {}) });
  const page = await adminApi<AdminTimelineResponse>(
    `/admin/users/${encodeURIComponent(userId)}/timeline?${query.toString()}`,
  );
  const sessions = groupSessions(page.events);
  if (sessions.length === 0) {
    return (
      <p className="muted" data-testid="timeline-empty">
        No activity recorded yet. Events reach this page within a couple of minutes.
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="timeline">
      {sessions.map((s) => (
        <section key={`${s.sessionId}-${s.start}`} className="card session">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 title={`${s.start} to ${s.end} (UTC)`}>
              {watDateTime(s.start)} to {watTime(s.end)} · {duration(Date.parse(s.end) - Date.parse(s.start))}
            </h2>
            <span className="muted small">
              {s.platform || 'unknown platform'}
              {s.appVersion ? ` ${s.appVersion}` : ''}
            </span>
          </div>
          <ol>
            {s.events.map((e) => (
              <li key={e.event_id}>
                <span className="muted small mono" title={e.ts}>
                  {watTime(e.ts)}
                </span>
                <span>{describeEvent(e)}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {page.next_before ? (
        <Link
          className="button"
          href={`/players/${userId}?tab=timeline&before=${encodeURIComponent(page.next_before)}`}
        >
          Older activity
        </Link>
      ) : null}
    </div>
  );
}

async function History({ userId }: { userId: string }) {
  const page = await adminApi<AdminAuditResponse>(`/admin/users/${encodeURIComponent(userId)}/audit`);
  return (
    <section className="card">
      <h2>Every staff look at this player and every action</h2>
      <table data-testid="history">
        <thead>
          <tr>
            <th>When (WAT)</th>
            <th>Who</th>
            <th>What</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {page.entries.map((e) => (
            <tr key={e.id}>
              <td title={e.created_at}>{watDateTime(e.created_at)}</td>
              <td>{e.actor_email ?? e.actor}</td>
              <td>{e.action.replaceAll('_', ' ')}</td>
              <td>{e.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
