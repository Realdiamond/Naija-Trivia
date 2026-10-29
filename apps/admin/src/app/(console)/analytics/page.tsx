/**
 * Analytics dashboards (doc 18 §9, build plan step 2.7j): Engagement & time, Growth & invites and
 * Retention, each over a range of WAT days and a platform. Every number follows its one definition
 * in doc 18 §10. Players are counted, never named.
 */
import Link from 'next/link';
import {
  ANALYTICS_BOARD_PERMISSION,
  ANALYTICS_BOARDS,
  routes,
  type AdminProfile,
  type AnalyticsBoard,
  type AnalyticsResponse,
  type EngagementBoard,
  type GrowthBoard,
  type RetentionBoard,
} from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { BarList, DayBars, HourHeatmap, ShareCurve } from '../../../lib/charts';

const TITLES: Record<AnalyticsBoard, string> = {
  engagement: 'Engagement & time',
  growth: 'Growth & invites',
  retention: 'Retention',
};
const PLATFORMS = [
  ['all', 'All platforms'],
  ['android', 'Android'],
  ['ios', 'iPhone'],
  ['web', 'Web'],
] as const;

const n = (value: number) => value.toLocaleString('en-NG');
const pct = (share: number | null) => (share === null ? '—' : `${Math.round(share * 1000) / 10}%`);
const one = (value: number) => (Math.round(value * 10) / 10).toLocaleString('en-NG');

function Tile({
  title,
  value,
  note,
  testId,
}: {
  title: string;
  value: string;
  note?: string;
  testId?: string;
}) {
  return (
    <div className="tile" data-testid={testId}>
      {title}
      <b>{value}</b>
      {note ? <span className="muted small">{note}</span> : null}
    </div>
  );
}

function Engagement({ b }: { b: EngagementBoard }) {
  const last = b.days.at(-1)?.day;
  return (
    <>
      <div className="tiles six">
        <Tile title="Players a day" value={one(b.summary.dau)} note="average DAU" testId="dau" />
        <Tile title="Last 7 days" value={n(b.summary.wau)} note="WAU" testId="wau" />
        <Tile title="Last 30 days" value={n(b.summary.mau)} note="MAU" testId="mau" />
        <Tile title="Stickiness" value={pct(b.summary.stickiness)} note="DAU ÷ MAU" />
        <Tile
          title="Minutes a player"
          value={one(b.summary.minutes_per_dau)}
          note={`${one(b.summary.sessions_per_dau)} sessions a player`}
          testId="minutes-per-dau"
        />
        <Tile
          title="Daily finished"
          value={pct(b.summary.daily_completion)}
          note="of the Dailies started"
          testId="daily-completion"
        />
      </div>
      <div className="grid2">
        <section className="card">
          <h2>Players a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: d.dau }))}
            label="Players a day"
            lastLabel={last?.slice(5)}
          />
          <h2>Minutes in the app a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: Math.round(d.minutes) }))}
            label="Minutes in the app a day"
            lastLabel={last?.slice(5)}
          />
        </section>
        <section className="card">
          <h2>How long sessions last</h2>
          <BarList
            rows={b.session_lengths.map((s) => ({ label: s.bucket, value: s.sessions }))}
            testId="session-lengths"
            empty="No sessions in this range."
          />
          <h2>Time by screen</h2>
          <BarList
            rows={b.screens.map((s) => ({ label: s.screen, value: Math.round(s.minutes) }))}
            empty="No screen times in this range."
          />
          <p className="muted small">Minutes, from players who allow behaviour analytics.</p>
        </section>
      </div>
      <section className="card">
        <h2>Busiest hours (WAT)</h2>
        <HourHeatmap rows={b.hours} />
      </section>
    </>
  );
}

function Growth({ b }: { b: GrowthBoard }) {
  const last = b.days.at(-1)?.day;
  return (
    <>
      <div className="tiles six">
        <Tile title="New players" value={n(b.summary.new_players)} testId="new-players" />
        <Tile title="Sign-ups" value={n(b.summary.signups)} testId="signups" />
        <Tile
          title="Invites"
          value={n(b.summary.invites_shared)}
          note={`shared · ${n(b.summary.invites_opened)} opened`}
          testId="invites"
        />
        <Tile
          title="K-factor"
          value={b.summary.k_factor === null ? '—' : b.summary.k_factor.toFixed(2)}
          note="invites a new player × opened"
          testId="k-factor"
        />
        <Tile
          title="Web to account"
          value={b.summary.web_new_players ? pct(b.summary.web_to_account / b.summary.web_new_players) : '—'}
          note={`${n(b.summary.web_to_account)} of ${n(b.summary.web_new_players)} new on the web`}
          testId="web-to-account"
        />
        <Tile
          title="Web to app"
          value={b.summary.web_new_players ? pct(b.summary.web_to_app / b.summary.web_new_players) : '—'}
          note="later played on a phone"
        />
      </div>
      <div className="grid2">
        <section className="card">
          <h2>New players a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: d.new_players }))}
            label="New players a day"
            lastLabel={last?.slice(5)}
          />
          <table data-testid="growth-days">
            <thead>
              <tr>
                <th>Day</th>
                <th>New</th>
                <th>Android</th>
                <th>iPhone</th>
                <th>Web</th>
                <th>Sign-ups</th>
              </tr>
            </thead>
            <tbody>
              {[...b.days]
                .reverse()
                .slice(0, 14)
                .map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td>{n(d.new_players)}</td>
                    <td>{n(d.android)}</td>
                    <td>{n(d.ios)}</td>
                    <td>{n(d.web)}</td>
                    <td>{n(d.signups)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>Where new players came from</h2>
          <BarList
            rows={b.sources.map((s) => ({ label: s.source, value: s.players }))}
            empty="Nobody new yet."
          />
          <h2>How they signed up</h2>
          <BarList
            rows={b.signup_methods.map((s) => ({ label: s.method, value: s.signups }))}
            empty="No sign-ups yet."
          />
          <h2>Invites shared</h2>
          <BarList
            rows={b.invite_channels.map((c) => ({ label: c.channel, value: c.shared }))}
            testId="invite-channels"
            empty="No invites shared yet."
          />
          <h2>Invites opened</h2>
          <BarList
            rows={b.invites_opened_by.map((o) => ({
              label: `${o.type} · ${n(o.in_app)} in the app, ${n(o.on_web)} on the web`,
              value: o.in_app + o.on_web,
            }))}
            empty="No invites opened yet."
          />
        </section>
      </div>
    </>
  );
}

function Retention({ b }: { b: RetentionBoard }) {
  return (
    <>
      <div className="tiles four">
        <Tile title="Day 1" value={pct(b.summary.d1)} note="back the next day" testId="d1" />
        <Tile title="Day 7" value={pct(b.summary.d7)} note="back a week later" testId="d7" />
        <Tile title="Day 30" value={pct(b.summary.d30)} note="back 30 days later" testId="d30" />
      </div>
      <section className="card">
        <h2>Back again, by days since they first played</h2>
        <ShareCurve rows={b.curve} label="Retention curve" />
      </section>
      <section className="card">
        <h2>By the week they first played</h2>
        {b.cohorts.length === 0 ? (
          <p className="muted small">Nobody new in this range.</p>
        ) : (
          <table data-testid="cohorts">
            <thead>
              <tr>
                <th>Week from</th>
                <th>New players</th>
                <th>Day 1</th>
                <th>Day 7</th>
                <th>Day 30</th>
              </tr>
            </thead>
            <tbody>
              {b.cohorts.map((c) => (
                <tr key={c.week}>
                  <td>{c.week}</td>
                  <td>{n(c.players)}</td>
                  <td>{pct(c.d1)}</td>
                  <td>{pct(c.d7)}</td>
                  <td>{pct(c.d30)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">A dash means that day has not come yet for everyone in the week.</p>
      </section>
    </>
  );
}

export default async function Analytics({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; from?: string; to?: string; platform?: string }>;
}) {
  const asked = await searchParams;
  const me = await adminApi<AdminProfile>('/admin/me');
  const boards = ANALYTICS_BOARDS.filter((b) => me.permissions.includes(ANALYTICS_BOARD_PERMISSION[b]));
  if (boards.length === 0) return <p className="error">You can&apos;t see the analytics dashboards.</p>;
  const board = boards.find((b) => b === asked.board) ?? boards[0]!;
  const platform = PLATFORMS.some(([p]) => p === asked.platform) ? asked.platform! : 'all';
  const filters = {
    ...(asked.from ? { from: asked.from } : {}),
    ...(asked.to ? { to: asked.to } : {}),
    ...(platform !== 'all' ? { platform } : {}),
  };
  const query = new URLSearchParams(filters).toString();

  let data: AnalyticsResponse;
  try {
    data = await adminApi<AnalyticsResponse>(routes.admin.analytics(board, query ? `?${query}` : ''));
  } catch (e) {
    return (
      <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load the dashboard.'}</p>
    );
  }
  const link = (params: Record<string, string>) => `/analytics?${new URLSearchParams(params).toString()}`;

  return (
    <>
      <div>
        <h1>Analytics</h1>
        <p className="muted">
          {data.from} to {data.to} (WAT)
          {platform === 'all' ? '' : ` · ${PLATFORMS.find(([p]) => p === platform)![1]}`}
        </p>
      </div>
      <nav className="tabs" aria-label="Dashboards">
        {boards.map((b) => (
          <Link key={b} href={link({ ...filters, board: b })} aria-current={b === board ? 'page' : undefined}>
            {TITLES[b]}
          </Link>
        ))}
      </nav>
      <form className="inline filters" method="get" action="/analytics">
        <input type="hidden" name="board" value={board} />
        <label>
          From
          <input type="date" name="from" defaultValue={data.from} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={data.to} />
        </label>
        <label>
          Platform
          <select name="platform" defaultValue={platform}>
            {PLATFORMS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Show</button>
      </form>
      {data.board === 'engagement' ? <Engagement b={data} /> : null}
      {data.board === 'growth' ? <Growth b={data} /> : null}
      {data.board === 'retention' ? <Retention b={data} /> : null}
    </>
  );
}
