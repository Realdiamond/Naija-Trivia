/**
 * Compliance beyond data requests (doc 18 §14, build plan step 2.7n): what we keep and for how
 * long with the retention job's last run, consent rates by purpose and platform, and the staff
 * list for the quarterly access review.
 */
import type { AdminComplianceOverview } from '@whosabi/shared-types';
import { watDateTime } from '../../../lib/format';
import { AccessReviewForm } from './Forms';

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : '—');

export function DataKept({ o }: { o: AdminComplianceOverview }) {
  return (
    <section className="card">
      <h2>What we keep, and for how long</h2>
      <p className="muted small">
        Doc 08 §4. The retention job runs each night after 03:00 WAT; a line is behind when something older
        than its time is still held a couple of days on.
      </p>
      <table data-testid="retention">
        <thead>
          <tr>
            <th>Data</th>
            <th>Kept</th>
            <th>Last run</th>
            <th>Oldest held</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {o.retention.map((r) => (
            <tr key={r.rule} data-testid={`retention-${r.rule}`}>
              <td>
                {r.data}
                <div className="muted small">by the {r.by === 'kept' ? 'law: nothing removes it' : r.by}</div>
              </td>
              <td>{r.keep}</td>
              <td>
                {r.last_run_at ? (
                  <>
                    {watDateTime(r.last_run_at)}
                    <div className="muted small">{r.last_rows?.toLocaleString('en-NG')} removed</div>
                  </>
                ) : r.by === 'retention job' ? (
                  'Not yet'
                ) : (
                  '—'
                )}
              </td>
              <td>{day(r.oldest)}</td>
              <td>
                {r.behind ? (
                  <span className="badge warn">Behind</span>
                ) : (
                  <span className="badge">On time</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function Consent({ o }: { o: AdminComplianceOverview }) {
  const purposes = [...new Set(o.consent.map((c) => c.purpose))];
  const platforms = [...new Set(o.consent.map((c) => c.platform))];
  return (
    <section className="card">
      <h2>Consent by purpose and platform</h2>
      <p className="muted small">
        Each player&apos;s latest answer for each purpose; deleted accounts left out.
      </p>
      {o.consent.length === 0 ? (
        <p className="muted small">No consent answers yet.</p>
      ) : (
        <table data-testid="consent">
          <thead>
            <tr>
              <th>Purpose</th>
              {platforms.map((p) => (
                <th key={p}>{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {purposes.map((purpose) => (
              <tr key={purpose}>
                <td>{purpose}</td>
                {platforms.map((platform) => {
                  const c = o.consent.find((x) => x.purpose === purpose && x.platform === platform);
                  return (
                    <td key={platform}>
                      {c ? (
                        <>
                          {pct(c.granted, c.answered)}
                          <div className="muted small">
                            {c.granted.toLocaleString('en-NG')} of {c.answered.toLocaleString('en-NG')}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function AccessReview({ o, canRecord }: { o: AdminComplianceOverview; canRecord: boolean }) {
  const { staff, last_review: last, due } = o.access;
  return (
    <>
      <section className="card">
        <h2>Quarterly access review</h2>
        <p data-testid="last-review">
          {last ? (
            <>
              Last reviewed {watDateTime(last.at)} by {last.by}: “{last.note}”
            </>
          ) : (
            'Never reviewed yet.'
          )}{' '}
          {due ? <span className="badge warn">Due</span> : <span className="badge">Done this quarter</span>}
        </p>
        {canRecord ? (
          <AccessReviewForm />
        ) : (
          <p className="muted small">The DPO or an owner records the review.</p>
        )}
      </section>
      <section className="card">
        <h2>Staff and their roles</h2>
        <table data-testid="access-staff">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Roles</th>
              <th>Last signed in</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name}
                  <div className="muted small">
                    {s.email}
                    {s.status !== 'active' ? ` · ${s.status}` : ''}
                  </div>
                </td>
                <td>
                  {s.roles.length === 0 ? (
                    <span className="muted small">No roles</span>
                  ) : (
                    s.roles.map((r) => (
                      <div key={r.role} className="small">
                        <b>{r.role}</b> · granted by {r.granted_by}
                        {r.approved_by ? `, approved by ${r.approved_by}` : ''}
                        {r.expires_at ? ` · until ${day(r.expires_at)}` : ''}
                      </div>
                    ))
                  )}
                </td>
                <td>{s.last_login_at ? watDateTime(s.last_login_at) : 'Never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
