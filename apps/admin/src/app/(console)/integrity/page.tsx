/**
 * The integrity queue (doc 18 §12, doc 10 §2, build plan step 2.7d): the nightly job's flags,
 * riskiest first, each with its evidence. A moderator looks at the player, acts on User 360 if
 * needed, and dismisses or marks the flag acted on. Nothing bans anyone automatically.
 */
import Link from 'next/link';
import { routes, type AdminIntegrityResponse } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { watDateTime } from '../../../lib/format';
import { Review } from './Review';

const STATUSES = [
  { key: 'open', label: 'Open' },
  { key: 'actioned', label: 'Acted on' },
  { key: 'dismissed', label: 'Dismissed' },
] as const;

export default async function Integrity({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: asked } = await searchParams;
  const status = STATUSES.find((s) => s.key === asked)?.key ?? 'open';
  let page: AdminIntegrityResponse;
  try {
    page = await adminApi<AdminIntegrityResponse>(routes.admin.integrity(status));
  } catch (e) {
    return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load the queue.'}</p>;
  }
  return (
    <>
      <div>
        <h1>Integrity</h1>
        <p className="muted">
          Flags from the nightly checks, riskiest first. Look at the player before deciding; nothing bans
          anyone automatically.
        </p>
      </div>
      <nav className="tabs" aria-label="Flags">
        {STATUSES.map((s) => (
          <Link
            key={s.key}
            href={`/integrity?status=${s.key}`}
            aria-current={status === s.key ? 'page' : undefined}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <section className="card">
        {page.flags.length === 0 ? (
          <p className="muted" data-testid="integrity-empty">
            {status === 'open' ? 'Nothing waiting.' : 'Nothing here yet.'}
          </p>
        ) : (
          <table data-testid="integrity">
            <thead>
              <tr>
                <th>Risk</th>
                <th>Player</th>
                <th>What</th>
                <th>Evidence</th>
                <th>{status === 'open' ? 'Raised (WAT)' : 'Decided'}</th>
              </tr>
            </thead>
            <tbody>
              {page.flags.map((f) => (
                <tr key={f.id} data-testid={`flag-${f.id}`}>
                  <td>
                    <b>{Math.round(f.score * 100)}%</b>
                  </td>
                  <td>
                    <Link href={`/players/${f.user_id}?tab=safety`}>{f.username ?? 'Guest'}</Link>
                  </td>
                  <td>{f.kind.replaceAll('_', ' ')}</td>
                  <td className="mono small">{JSON.stringify(f.evidence)}</td>
                  <td>
                    {status === 'open' ? (
                      <>
                        {watDateTime(f.created_at)}
                        <Review id={f.id} />
                      </>
                    ) : (
                      <>
                        {f.reviewed_by} · {watDateTime(f.reviewed_at)}
                        {f.review_note ? <div className="muted small">{f.review_note}</div> : null}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
