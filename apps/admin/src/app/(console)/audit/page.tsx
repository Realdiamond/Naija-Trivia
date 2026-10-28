/** The audit log (doc 18 §16): every staff view and action, newest first. Reading it is logged too. */
import Link from 'next/link';
import type { AdminAuditResponse } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { watDateTime } from '../../../lib/format';

interface Filters {
  actor?: string;
  entity?: string;
  entity_id?: string;
  before?: string;
}

export default async function Audit({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams;
  const query = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  let page: AdminAuditResponse;
  try {
    page = await adminApi<AdminAuditResponse>(`/admin/audit?${query.toString()}`);
  } catch (e) {
    return (
      <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load the audit log.'}</p>
    );
  }
  const next = new URLSearchParams(query);
  if (page.next_before) next.set('before', String(page.next_before));
  return (
    <>
      <h1>Audit log</h1>
      <form action="/audit" className="inline">
        <label>
          Staff id
          <input name="actor" defaultValue={filters.actor ?? ''} />
        </label>
        <label>
          About
          <select name="entity" defaultValue={filters.entity ?? ''}>
            <option value="">Anything</option>
            <option value="user">A player</option>
            <option value="user_search">Player searches</option>
            <option value="admin">Staff</option>
            <option value="audit_log">The audit log</option>
          </select>
        </label>
        <label>
          Id
          <input name="entity_id" defaultValue={filters.entity_id ?? ''} />
        </label>
        <button type="submit">Filter</button>
      </form>
      <section className="card">
        <table data-testid="audit">
          <thead>
            <tr>
              <th>When (WAT)</th>
              <th>Who</th>
              <th>What</th>
              <th>About</th>
              <th>Reason</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {page.entries.map((e) => (
              <tr key={e.id}>
                <td title={e.created_at}>{watDateTime(e.created_at)}</td>
                <td>{e.actor_email ?? e.actor}</td>
                <td>{e.action.replaceAll('_', ' ')}</td>
                <td>
                  {e.entity === 'user' && e.entity_id ? (
                    <Link href={`/players/${e.entity_id}`}>{e.entity_id}</Link>
                  ) : (
                    `${e.entity}${e.entity_id ? ` ${e.entity_id}` : ''}`
                  )}
                </td>
                <td>{e.reason ?? ''}</td>
                <td className="mono">{e.ip ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {page.next_before ? (
        <Link className="button" href={`/audit?${next.toString()}`}>
          Older entries
        </Link>
      ) : null}
    </>
  );
}
