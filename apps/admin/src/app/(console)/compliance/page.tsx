/**
 * Compliance (doc 18 §14, build plan steps 2.8a and 2.7n): the data request queue and its 30-day
 * clock; what we keep and for how long; consent rates; the quarterly access review.
 * Players delete their account and download their data themselves in the app; requests that
 * come by email or the help centre are logged by support on User 360 and completed here by the
 * DPO: an export to send them, or erasing the account. Every step is in the audit log.
 */
import Link from 'next/link';
import {
  routes,
  type AdminComplianceOverview,
  type AdminDsarResponse,
  type AdminProfile,
} from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { watDateTime } from '../../../lib/format';
import { EraseForm, ExportLink } from './Forms';
import { AccessReview, Consent, DataKept } from './Overview';

const TABS = [
  ['requests', 'Requests'],
  ['kept', 'Data kept'],
  ['consent', 'Consent'],
  ['access', 'Access review'],
] as const;

const KINDS: Record<string, string> = {
  access: 'A copy of their data',
  erasure: 'Delete the account',
  rectification: 'Correct their data',
  portability: 'Their data to take elsewhere',
  objection: 'Object to processing',
};

export default async function Compliance({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tab?: string }>;
}) {
  const { status: asked, tab: askedTab } = await searchParams;
  const status = asked === 'done' ? 'done' : 'open';
  const tab = TABS.find(([t]) => t === askedTab)?.[0] ?? 'requests';
  const me = await adminApi<AdminProfile>('/admin/me');
  const canErase = me.permissions.includes('compliance.erase');
  const tabs = (
    <nav className="tabs" aria-label="Compliance">
      {TABS.map(([key, label]) => (
        <Link
          key={key}
          href={key === 'requests' ? '/compliance' : `/compliance?tab=${key}`}
          aria-current={tab === key ? 'page' : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
  if (tab !== 'requests') {
    let overview: AdminComplianceOverview;
    try {
      overview = await adminApi<AdminComplianceOverview>(routes.admin.complianceOverview);
    } catch (e) {
      return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load compliance.'}</p>;
    }
    return (
      <>
        <h1>Compliance</h1>
        {tabs}
        {tab === 'kept' ? <DataKept o={overview} /> : null}
        {tab === 'consent' ? <Consent o={overview} /> : null}
        {tab === 'access' ? (
          <AccessReview o={overview} canRecord={me.permissions.includes('compliance.review')} />
        ) : null}
      </>
    );
  }
  let page: AdminDsarResponse;
  try {
    page = await adminApi<AdminDsarResponse>(routes.admin.dsar(status));
  } catch (e) {
    return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load the requests.'}</p>;
  }
  const now = Date.now();
  return (
    <>
      <div>
        <h1>Compliance</h1>
        <p className="muted">
          Due within 30 days of being asked (NDPA). Players who can sign in do it themselves in the app; these
          came another way.
        </p>
      </div>
      {tabs}
      <nav className="tabs" aria-label="Requests">
        <Link href="/compliance" aria-current={status === 'open' ? 'page' : undefined}>
          Open
        </Link>
        <Link href="/compliance?status=done" aria-current={status === 'done' ? 'page' : undefined}>
          Done
        </Link>
      </nav>
      <section className="card">
        {page.requests.length === 0 ? (
          <p className="muted" data-testid="dsar-empty">
            {status === 'open' ? 'Nothing waiting.' : 'Nothing yet.'}
          </p>
        ) : (
          <table data-testid="dsar-queue">
            <thead>
              <tr>
                <th>Player</th>
                <th>Asked for</th>
                <th>How</th>
                <th>{status === 'open' ? 'Due' : 'Done'}</th>
                <th>{status === 'open' ? 'Complete it' : 'By'}</th>
              </tr>
            </thead>
            <tbody>
              {page.requests.map((r) => {
                const overdue = status === 'open' && Date.parse(r.due_at) < now;
                return (
                  <tr key={r.id} data-testid={`dsar-${r.id}`}>
                    <td>
                      <Link href={`/players/${r.user_id}`}>{r.username ?? r.user_id}</Link>
                    </td>
                    <td>{KINDS[r.kind] ?? r.kind}</td>
                    <td className="small">
                      {r.source === 'app' ? 'In the app' : r.note}
                      {r.started_by ? <div className="muted">logged by {r.started_by}</div> : null}
                    </td>
                    <td>
                      {status === 'open' ? (
                        <span className={overdue ? 'badge warn' : 'badge off'}>
                          {overdue ? 'Overdue · ' : ''}
                          {watDateTime(r.due_at)}
                        </span>
                      ) : (
                        watDateTime(r.completed_at)
                      )}
                    </td>
                    <td>
                      {status === 'done' ? (
                        r.handled_by
                      ) : r.kind === 'erasure' ? (
                        canErase ? (
                          <EraseForm userId={r.user_id} />
                        ) : (
                          <span className="muted small">For the DPO</span>
                        )
                      ) : (
                        <ExportLink userId={r.user_id} />
                      )}
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
