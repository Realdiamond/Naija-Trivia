/**
 * Player reports (PRD US-9, doc 04 §3): questions with open reports, the ones already taken out
 * of the game first. The nightly check adds its own from the numbers (step 2.6b). An editor
 * answers within 24 hours.
 */
import Link from 'next/link';
import type { AdminProfile, AdminReportsResponse } from '@whosabi/shared-types';
import { adminApi } from '../../../lib/api';
import { CATEGORY_NAME, REASON_LABEL, STATUS_LABEL, STATUS_TONE } from '../../../lib/content';
import { watDateTime } from '../../../lib/format';
import { ResolveReports } from './ResolveReports';

export default async function Reports() {
  const [me, { groups }] = await Promise.all([
    adminApi<AdminProfile>('/admin/me'),
    adminApi<AdminReportsResponse>('/admin/reports'),
  ]);
  const canResolve = me.permissions.includes('content.publish');
  return (
    <>
      <h1>Player reports</h1>
      <p className="muted">
        Five &quot;wrong answer&quot; reports, or reports on more than 3% of plays (from 100 plays), take a
        question out of the game until someone here decides. Each night the numbers add their own: from 300
        plays, fewer than 5% or more than 97% right, and most players picking the same wrong option, which
        also takes the question out.
      </p>
      {groups.length === 0 ? <p className="ok">No open reports.</p> : null}
      {groups.map((g) => (
        <div key={g.question.id} className="card stack" data-testid={`report-${g.question.id}`}>
          <div className="row">
            <span className={`badge ${STATUS_TONE[g.question.status]}`}>
              {g.auto_suspended ? 'Taken out automatically' : STATUS_LABEL[g.question.status]}
            </span>
            <span className="muted small">
              {CATEGORY_NAME[g.question.category_id] ?? g.question.category_id} ·{' '}
              {g.plays.toLocaleString('en-NG')} plays · first {watDateTime(g.first_at)} · latest{' '}
              {watDateTime(g.last_at)}
            </span>
          </div>
          <Link className="qtext" href={`/questions/${g.question.id}`}>
            {g.question.text}
          </Link>
          <div className="chips">
            {Object.entries(g.reasons).map(([reason, n]) => (
              <span key={reason} className="badge warn">
                {REASON_LABEL[reason] ?? reason}: {n}
              </span>
            ))}
          </div>
          {g.notes.length > 0 ? (
            <ul className="problems">
              {g.notes.map((note, i) => (
                <li key={i}>&ldquo;{note}&rdquo;</li>
              ))}
            </ul>
          ) : null}
          {canResolve ? <ResolveReports id={g.question.id} /> : null}
        </div>
      ))}
    </>
  );
}
