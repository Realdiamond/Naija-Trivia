/**
 * LiveOps (doc 18 §11): flags and kill switches and the in-app status banner (build plan step
 * 2.7c, `liveops.flags`), the game and economy values with their history and rollback (step
 * 2.7g, `liveops.config`), Home banners and events (step 2.7h) and experiments (step 2.7s), both
 * `liveops.config` too. Apps look again every 45 seconds, so a change reaches every player within a
 * minute (AD-7); switching a kill switch is announced in the staff alerts.
 */
import {
  routes,
  type AdminBannerResponse,
  type AdminConfigResponse,
  type AdminExperiment,
  type AdminExperimentsResponse,
  type AdminFlag,
  type AdminFlagsResponse,
  type AdminLiveEventsResponse,
  type AdminProfile,
} from '@whosabi/shared-types';
import { CATEGORY_NAME } from '../../../lib/content';
import { AdminApiError, adminApi } from '../../../lib/api';
import { watDateTime } from '../../../lib/format';
import {
  BannerForm,
  ConfigForm,
  EndEventForm,
  EventForm,
  ExperimentForm,
  ExperimentMoveForm,
  FlagForm,
} from './Forms';

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

function audienceOf(e: AdminExperiment): string {
  const parts = [
    e.audience.platforms?.length ? e.audience.platforms.join(', ') : 'every platform',
    e.audience.min_app_version ? `from ${e.audience.min_app_version}` : null,
    `${e.audience.percent}% of players`,
  ].filter(Boolean);
  return parts.join(' · ');
}

const STATUS: Record<AdminExperiment['status'], string> = {
  draft: 'Draft',
  running: 'Running',
  stopped: 'Stopped',
};

function Experiments({ experiments }: { experiments: AdminExperimentsResponse }) {
  return (
    <section className="card">
      <h2>Experiments</h2>
      <p className="muted small">
        A share of players gets each variant, the same one on every device. Players count once the app shows
        them their variant. Variants and who gets them are fixed once it starts; read the results on the
        dashboards with the primary metric and guardrails.
      </p>
      <table data-testid="experiments">
        <thead>
          <tr>
            <th>Experiment</th>
            <th>Who</th>
            <th>Variants · players who saw it</th>
            <th>State</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {experiments.experiments.map((e) => (
            <tr key={e.key} data-testid={`experiment-${e.key.replaceAll('.', '-')}`}>
              <td>
                {e.description}
                <div className="mono muted small">{e.key}</div>
                <div className="muted small">
                  {e.hypothesis} · measured by <span className="mono">{e.primary_metric}</span>
                  {e.guardrails.length ? `, watching ${e.guardrails.join(', ')}` : ''} · {e.created_by}
                </div>
              </td>
              <td className="small">{audienceOf(e)}</td>
              <td className="small">
                {e.variants.map((v, i) => (
                  <div key={v.key}>
                    <span className="mono">{v.key}</span> ({v.weight}){i === 0 ? ' control' : ''} ·{' '}
                    <b>{e.exposed[v.key] ?? 0}</b>
                  </div>
                ))}
              </td>
              <td className="small">
                <span
                  className={e.status === 'running' ? 'badge' : 'badge off'}
                  data-testid={`experiment-state-${e.key.replaceAll('.', '-')}`}
                >
                  {STATUS[e.status]}
                </span>
                {e.started_at ? <div className="muted">from {watDateTime(e.started_at)}</div> : null}
                {e.stopped_at ? <div className="muted">to {watDateTime(e.stopped_at)}</div> : null}
              </td>
              <td>
                {e.status === 'draft' ? <ExperimentMoveForm experimentKey={e.key} to="start" /> : null}
                {e.status === 'running' ? <ExperimentMoveForm experimentKey={e.key} to="stop" /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary data-testid="experiment-new">Write one down</summary>
        <ExperimentForm />
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
  let experiments: AdminExperimentsResponse | null;
  try {
    [flags, banner, config, events, experiments] = await Promise.all([
      canFlags ? adminApi<AdminFlagsResponse>(routes.admin.flags()) : null,
      canFlags ? adminApi<AdminBannerResponse>(routes.admin.banner()) : null,
      canConfig ? adminApi<AdminConfigResponse>(routes.admin.config()) : null,
      canConfig ? adminApi<AdminLiveEventsResponse>(routes.admin.events()) : null,
      canConfig ? adminApi<AdminExperimentsResponse>(routes.admin.experiments()) : null,
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
      {experiments ? <Experiments experiments={experiments} /> : null}
    </>
  );
}
