/**
 * Segments (doc 18 §9, build plan step 2.7o): groups of players by who they are and what they
 * do, their size day by day, and exports of pseudonymous ids that a second person approves.
 */
import {
  routes,
  STATE_NAMES,
  type AdminProfile,
  type AdminSegmentsResponse,
  type SegmentRule,
} from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { DayBars } from '../../../lib/charts';
import { watDateTime } from '../../../lib/format';
import { decideExport, deleteSegment } from './actions';
import { AskExport, SegmentBuilder } from './Builder';

function describe(rule: SegmentRule): string {
  switch (rule.field) {
    case 'home_state':
      return `from ${rule.in.map((s) => STATE_NAMES[s]).join(' or ')}`;
    case 'platform':
      return `plays on ${rule.in.join(' or ')}`;
    case 'age_band':
      return `aged ${rule.in.map((a) => a.replace('_', '–').replace('–plus', '+')).join(' or ')}`;
    case 'account':
      return rule.is === 'guest' ? 'a guest' : 'signed up';
    case 'joined_within_days':
      return `joined in the last ${rule.days} days`;
    case 'active_within_days':
      return `played in the last ${rule.days} days`;
    case 'inactive_for_days':
      return `not played for ${rule.days} days`;
    case 'duels_finished':
      return `${rule.min}+ duels in the last ${rule.within_days} days`;
    case 'purchased':
      return rule.ever ? 'bought coins' : 'never bought coins';
    case 'coins_at_least':
      return `${rule.n}+ coins`;
    case 'level_at_least':
      return `level ${rule.n}+`;
    case 'streak_at_least':
      return `a ${rule.n}+ day streak`;
  }
}

export default async function Segments() {
  const me = await adminApi<AdminProfile>('/admin/me');
  const canApprove = me.permissions.includes('segments.approve');
  let page: AdminSegmentsResponse;
  try {
    page = await adminApi<AdminSegmentsResponse>(routes.admin.segments);
  } catch (e) {
    return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load segments.'}</p>;
  }
  const now = Date.now();
  return (
    <>
      <div>
        <h1>Segments</h1>
        <p className="muted">
          Players by who they are and what they do. Exports hold pseudonymous ids only, need an owner or admin
          to approve them, and can be downloaded for a day by the one who asked.
        </p>
      </div>

      <section className="card">
        <h2>Build a segment</h2>
        <SegmentBuilder />
      </section>

      <section className="card">
        <h2>Saved segments</h2>
        {page.segments.length === 0 ? (
          <p className="muted small">None yet.</p>
        ) : (
          <div className="stack" data-testid="segments">
            {page.segments.map((s) => (
              <div key={s.id} className="card" data-testid={`segment-${s.id}`}>
                <div className="row spread">
                  <div>
                    <b>{s.name}</b>
                    <div className="muted small">{s.definition.rules.map(describe).join(', ')}</div>
                    <div className="muted small">
                      by {s.created_by} · {s.last_count?.toLocaleString('en-NG') ?? '—'} players
                      {s.last_computed_at ? ` on ${watDateTime(s.last_computed_at)}` : ''}
                    </div>
                  </div>
                  <form action={deleteSegment.bind(null, s.id)}>
                    <button type="submit" className="small danger">
                      Delete
                    </button>
                  </form>
                </div>
                {s.trend.length > 1 ? (
                  <DayBars
                    rows={s.trend.map((d) => ({ day: d.day, value: d.players }))}
                    label={`${s.name}: players a day`}
                    lastLabel={s.trend.at(-1)!.day.slice(5)}
                  />
                ) : null}
                <AskExport segmentId={s.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Exports</h2>
        {page.exports.length === 0 ? (
          <p className="muted small">No exports asked for this week.</p>
        ) : (
          <table data-testid="exports">
            <thead>
              <tr>
                <th>Segment</th>
                <th>Asked by, and why</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {page.exports.map((x) => {
                const live = x.status === 'approved' && x.expires_at && Date.parse(x.expires_at) > now;
                return (
                  <tr key={x.id} data-testid={`export-${x.id}`}>
                    <td>{x.segment_name}</td>
                    <td>
                      {x.requested_by}
                      <div className="muted small">{x.reason}</div>
                    </td>
                    <td>
                      {x.status === 'pending' ? (
                        <span className="badge warn">Waiting for approval</span>
                      ) : x.status === 'approved' ? (
                        <span className="badge">
                          Approved by {x.decided_by}
                          {x.expires_at ? `, until ${watDateTime(x.expires_at)}` : ''}
                        </span>
                      ) : (
                        <span className="badge off">Turned down by {x.decided_by}</span>
                      )}
                    </td>
                    <td>
                      {x.status === 'pending' && canApprove && !x.yours ? (
                        <div className="row">
                          <form action={decideExport.bind(null, x.id, true)}>
                            <button type="submit" className="small">
                              Approve
                            </button>
                          </form>
                          <form action={decideExport.bind(null, x.id, false)}>
                            <button type="submit" className="small danger">
                              Turn down
                            </button>
                          </form>
                        </div>
                      ) : null}
                      {live && x.yours ? (
                        <a href={`/segments/export/${x.id}`} data-testid={`download-${x.id}`}>
                          Download CSV
                        </a>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
