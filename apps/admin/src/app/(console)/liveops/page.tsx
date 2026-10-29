/**
 * LiveOps (doc 18 §11): flags and kill switches and the in-app status banner (build plan step
 * 2.7c, `liveops.flags`), the game and economy values with their history and rollback (step
 * 2.7g, `liveops.config`), and Home banners and events (step 2.7h, `liveops.config`). Apps look again every 45 seconds, so a change reaches every player
 * within a minute (AD-7); switching a kill switch is announced in the staff alerts.
 */
import {
  routes,
  type AdminBannerResponse,
  type AdminConfigResponse,
  type AdminFlag,
  type AdminFlagsResponse,
  type AdminLiveEventsResponse,
  type AdminProfile,
} from '@whosabi/shared-types';
import { CATEGORY_NAME } from '../../../lib/content';
import { AdminApiError, adminApi } from '../../../lib/api';
import { watDateTime } from '../../../lib/format';
import { BannerForm, ConfigForm, EndEventForm, EventForm, FlagForm } from './Forms';

function who(flag: AdminFlag): string {
  if (!flag.enabled) return 'Off for everyone';
  const rule = flag.rules[0];
  if (!rule) return 'On for everyone';
  const parts = [
    rule.platform ? `on ${rule.platform}` : null,
    rule.min_app_version ? `from version ${rule.min_app_version}` : null,
    rule.percent !== undefined ? `${rule.percent}% of players` : null,
  ].filter(Boolean);
  return `On ${parts.join(', ')}`;
}

const dashed = (key: string) => key.replaceAll('.', '-');

function Flags({ flags, banner }: { flags: AdminFlagsResponse; banner: AdminBannerResponse }) {
  return (
    <div className="grid2">
      <section className="card">
        <h2>Flags and kill switches</h2>
        <div className="stack">
          {flags.flags.map((flag) => (
            <article key={flag.key} className="flag">
              <div className="row spread">
                <div>
                  <h3>
                    {flag.description}{' '}
                    {flag.kill_switch ? <span className="badge off">kill switch</span> : null}
                  </h3>
                  <p className="mono muted small">{flag.key}</p>
                </div>
                <span
                  className={flag.enabled ? 'badge' : 'badge warn'}
                  data-testid={`flag-state-${dashed(flag.key)}`}
                >
                  {who(flag)}
                </span>
              </div>
              <p className="muted small">
                {flag.updated_by
                  ? `Changed by ${flag.updated_by}, ${watDateTime(flag.updated_at)}`
                  : 'Not changed yet'}
              </p>
              <details>
                <summary data-testid={`flag-change-${dashed(flag.key)}`}>Change</summary>
                <FlagForm flag={flag} />
              </details>
            </article>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>Status banner</h2>
        {banner.banner ? (
          <p
            className={banner.banner.level === 'warning' ? 'banner-preview warn' : 'banner-preview'}
            data-testid="banner-now"
          >
            {banner.banner.text_en}
          </p>
        ) : (
          <p className="muted small" data-testid="banner-none">
            No banner showing in the app.
          </p>
        )}
        {banner.updated_by ? (
          <p className="muted small">
            Last changed by {banner.updated_by}, {watDateTime(banner.updated_at)}
          </p>
        ) : null}
        <BannerForm banner={banner.banner} />
      </section>
    </div>
  );
}

function Values({ config }: { config: AdminConfigResponse }) {
  return (
    <section className="card">
      <h2>Game and economy values</h2>
      <p className="muted small">
        Change one without a release. Every change keeps its reason and can be rolled back. The game&apos;s
        other numbers (timers, scoring, room sizes) stay as written for now.
      </p>
      <table data-testid="config">
        <thead>
          <tr>
            <th>Value</th>
            <th>Now</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {config.values.map((v) => (
            <tr key={v.key}>
              <td>
                {v.label}
                <div className="mono muted small">{v.key}</div>
              </td>
              <td>
                <b data-testid={`config-now-${dashed(v.key)}`}>{v.value}</b>
                <div className="muted small">
                  {v.value === v.default ? 'the default' : `default ${v.default}`}
                  {v.changed_by ? ` · ${v.changed_by}, ${watDateTime(v.changed_at)}` : ''}
                </div>
              </td>
              <td>
                <details>
                  <summary data-testid={`config-change-${dashed(v.key)}`}>Change</summary>
                  <ConfigForm value={v} />
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Events({ events }: { events: AdminLiveEventsResponse }) {
  return (
    <section className="card">
      <h2>Home banners and events</h2>
      <p className="muted small">
        What players see on Home while it runs: news, a flash pack, or Weekend Wahala&apos;s double XP in
        duels. Home shows the two newest at once.
      </p>
      <table data-testid="events">
        <thead>
          <tr>
            <th>Event</th>
            <th>When (WAT)</th>
            <th>State</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {events.events.map((e) => (
            <tr key={e.id} data-testid={`event-${e.id}`}>
              <td>
                {e.title_en}
                <div className="muted small">
                  {e.kind === 'double_xp'
                    ? `Double XP · ${e.category_id ? (CATEGORY_NAME[e.category_id] ?? e.category_id) : 'every category'}`
                    : 'Home banner'}
                  {e.platforms ? ` · ${e.platforms.join(', ')}` : ''} · {e.created_by}
                </div>
              </td>
              <td className="small">
                {watDateTime(e.starts_at)} → {watDateTime(e.ended_at ?? e.ends_at)}
              </td>
              <td>
                <span
                  className={e.state === 'live' ? 'badge' : 'badge off'}
                  data-testid={`event-state-${e.id}`}
                >
                  {e.state === 'live' ? 'Running' : e.state === 'scheduled' ? 'Scheduled' : 'Ended'}
                </span>
              </td>
              <td>{e.state === 'ended' ? null : <EndEventForm id={e.id} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary data-testid="event-new">Schedule one</summary>
        <EventForm />
      </details>
    </section>
  );
}

export default async function LiveOps() {
  const me = await adminApi<AdminProfile>('/admin/me');
  const canFlags = me.permissions.includes('liveops.flags');
  const canConfig = me.permissions.includes('liveops.config');
  let flags: AdminFlagsResponse | null;
  let banner: AdminBannerResponse | null;
  let config: AdminConfigResponse | null;
  let events: AdminLiveEventsResponse | null;
  try {
    [flags, banner, config, events] = await Promise.all([
      canFlags ? adminApi<AdminFlagsResponse>(routes.admin.flags()) : null,
      canFlags ? adminApi<AdminBannerResponse>(routes.admin.banner()) : null,
      canConfig ? adminApi<AdminConfigResponse>(routes.admin.config()) : null,
      canConfig ? adminApi<AdminLiveEventsResponse>(routes.admin.events()) : null,
    ]);
  } catch (e) {
    return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load LiveOps.'}</p>;
  }
  return (
    <>
      <div>
        <h1>LiveOps</h1>
        <p className="muted">
          Changes reach every player within a minute. Each one needs a reason and is logged.
        </p>
      </div>
      {flags && banner ? <Flags flags={flags} banner={banner} /> : null}
      {events ? <Events events={events} /> : null}
      {config ? <Values config={config} /> : null}
    </>
  );
}
