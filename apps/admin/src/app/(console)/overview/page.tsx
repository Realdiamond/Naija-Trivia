/**
 * Overview, the console's home (mockup 31, doc 18 §5): today so far against the same time a week
 * ago, the charts, health and the work waiting. The page reloads its numbers every 15 seconds.
 */
import Link from 'next/link';
import {
  routes,
  STATE_NAMES,
  type ConsoleOverview,
  type HomeState,
  type WeekCount,
} from '@whosabi/shared-types';
import { adminApi } from '../../../lib/api';
import { BarList, DayBars, HourLines } from '../../../lib/charts';
import { watDateTime } from '../../../lib/format';
import { AutoRefresh } from '../AutoRefresh';

const n = (v: number) => v.toLocaleString('en-NG');

/** "▲ 9% vs last week", or nothing when last week had none to compare with. */
function Change({ count }: { count: WeekCount }) {
  if (count.last_week === 0) return <span className="muted small">none last week</span>;
  const pct = Math.round(((count.today - count.last_week) / count.last_week) * 100);
  return (
    <span className={pct >= 0 ? 'up small' : 'down small'}>
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% vs last week
    </span>
  );
}

const SOURCE_NAMES: Record<string, string> = { organic: 'Found us', invite: 'Invite link' };

export default async function OverviewPage() {
  const o = await adminApi<ConsoleOverview>(routes.admin.consoleOverview());
  const matches: WeekCount = {
    today: o.today.duels_finished.today + o.today.party_games.today + o.today.dailies.today,
    last_week: o.today.duels_finished.last_week + o.today.party_games.last_week + o.today.dailies.last_week,
  };
  const weekday = new Date(o.at).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Africa/Lagos' });
  return (
    <>
      <AutoRefresh seconds={15} />
      <div className="row spread">
        <div>
          <h1>Overview</h1>
          <p className="muted">
            Today so far, against the same time last {weekday} · updated {watDateTime(o.at)} · refreshes every
            15 s
          </p>
        </div>
      </div>

      <div className="tiles six" data-testid="overview-tiles">
        <div className="tile">
          Online now
          <b data-testid="online-now">{n(o.online.total)}</b>
          <span className="muted small">
            Android {n(o.online.android)} · iOS {n(o.online.ios)} · Web {n(o.online.web)}
          </span>
        </div>
        <div className="tile">
          Players today
          <b data-testid="players-today">{n(o.today.active_players.today)}</b>
          <Change count={o.today.active_players} />
          <span className="muted small">
            New: {n(o.today.new_players.today)} · sign-ups {n(o.today.signups.today)}
          </span>
        </div>
        <div className="tile">
          Matches
          <b>{n(matches.today)}</b>
          <Change count={matches} />
          <span className="muted small">
            Duels {n(o.today.duels_finished.today)} · party {n(o.today.party_games.today)} · Dailies{' '}
            {n(o.today.dailies.today)}
          </span>
        </div>
        <div className="tile">
          Minutes per player
          <b>{o.time.minutes_per_player ?? '–'}</b>
          <span className="muted small">
            Median session{' '}
            {o.time.median_session_minutes === null ? '–' : `${o.time.median_session_minutes} min`}
          </span>
        </div>
        <div className="tile">
          Money today
          <b data-testid="money-today">₦{n(o.money.revenue_ngn)}</b>
          <span className="muted small">
            {n(o.money.purchases)} purchases
            {o.money.test_purchases ? ` (+${o.money.test_purchases} tests)` : ''} · {n(o.money.rewarded_ads)}{' '}
            rewarded ads
          </span>
        </div>
        <div className="tile">
          Coins
          <b>
            +{n(o.money.coins_earned)} / −{n(o.money.coins_spent)}
          </b>
          <span className="muted small">earned / spent today</span>
        </div>
      </div>

      <div className="grid2 charts">
        <section className="card">
          <div className="row spread">
            <h2>Players active by hour</h2>
            <span className="legend">
              <i className="key today" /> Today <i className="key last-week" /> Last {weekday}
            </span>
          </div>
          <HourLines rows={o.charts.by_hour} />
        </section>
        <section className="card">
          <h2>Daily players, last 30 days</h2>
          <DayBars
            rows={o.charts.active_30d.map((r) => ({ day: r.day, value: r.players }))}
            label="Daily players, last 30 days"
          />
        </section>
      </div>

      <div className="tiles four">
        <section className="card">
          <h2>Top states today</h2>
          <BarList
            testId="top-states"
            rows={o.charts.top_states.map((s) => ({
              label: STATE_NAMES[s.state as HomeState] ?? s.state,
              value: s.players,
            }))}
          />
        </section>
        <section className="card">
          <h2>New players by source</h2>
          <BarList
            rows={o.charts.new_by_source.map((s) => ({
              label: SOURCE_NAMES[s.source] ?? s.source,
              value: s.players,
            }))}
          />
          <h2 className="spaced">Top categories today</h2>
          <BarList rows={o.charts.top_categories.map((c) => ({ label: c.category, value: c.answers }))} />
        </section>
        <section className="card">
          <h2>Health</h2>
          <dl className="facts">
            <dt>Event ingest delay</dt>
            <dd>{o.health.last_event_loaded_s === null ? '–' : `${n(o.health.last_event_loaded_s)} s`}</dd>
            <dt>Events waiting to load</dt>
            <dd>{n(o.health.events_waiting)}</dd>
          </dl>
          {o.alerts.length > 0 ? (
            <ul className="warnings" data-testid="overview-alerts">
              {o.alerts.map((a) => (
                <li key={`${a.created_at}${a.title}`}>
                  <b>{a.title}</b> {a.body} <span className="muted small">{watDateTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No problems in the last 24 hours.</p>
          )}
        </section>
        <section className="card">
          <h2>Queues</h2>
          <ul className="queues" data-testid="queues">
            <li>
              <Link href="/reports">Question reports</Link>{' '}
              <span className="count">{n(o.queues.reported_questions)}</span>
            </li>
            <li>
              <Link href="/questions?status=suspended">Questions suspended</Link>{' '}
              <span className="count">{n(o.queues.suspended_questions)}</span>
            </li>
            <li>
              <span>Integrity flags</span> <span className="count">{n(o.queues.open_flags)}</span>
            </li>
            <li>
              <span>Data requests due in 7 days</span> <span className="count">{n(o.queues.dsars_due)}</span>
            </li>
          </ul>
          <p className="muted small">
            Live now: <Link href="/live">{n(o.live.party_rooms)} party rooms</Link> ({n(o.live.party_players)}{' '}
            players) · {n(o.live.duels_waiting)} duels waiting on a turn
          </p>
        </section>
      </div>
    </>
  );
}
