/** Player search (doc 18 §7.1): masked results, and every search goes into the audit log. */
import Link from 'next/link';
import type { AdminUserSearchResponse } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { watDateTime } from '../../../lib/format';

const MATCHED = {
  username: 'username',
  user_id: 'user ID',
  phone: 'phone number',
  device_id: 'device ID',
  duel_id: 'player in the duel',
} as const;

export default async function Players({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? '').trim();
  let result: AdminUserSearchResponse | null = null;
  let error: string | null = null;
  if (q.length >= 2) {
    try {
      result = await adminApi<AdminUserSearchResponse>(`/admin/users?q=${encodeURIComponent(q)}`);
    } catch (e) {
      error = e instanceof AdminApiError ? e.message : 'Search failed.';
    }
  }
  return (
    <>
      <h1>Players</h1>
      <form action="/players" className="inline" role="search">
        <label style={{ flex: 1 }}>
          Find a player
          <input name="q" defaultValue={q} placeholder="Username, user ID, phone, device ID or duel ID" />
        </label>
        <button className="primary" type="submit">
          Search
        </button>
      </form>
      <p className="muted small">
        Phone numbers match exactly and are logged. Results never show full numbers.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {result ? (
        <div className="card">
          {result.users.length === 0 ? (
            <p className="muted">Nobody found for “{q}”.</p>
          ) : (
            <table data-testid="results">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Status</th>
                  <th>Level</th>
                  <th>Joined</th>
                  <th>Last seen</th>
                  <th>Found by</th>
                </tr>
              </thead>
              <tbody>
                {result.users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <Link href={`/players/${user.id}`}>{user.username ?? 'Guest'}</Link>
                      <div className="mono muted">{user.id}</div>
                    </td>
                    <td>{user.status}</td>
                    <td>{user.level}</td>
                    <td>{watDateTime(user.created_at)}</td>
                    <td>{watDateTime(user.last_seen_at)}</td>
                    <td>{MATCHED[user.matched]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </>
  );
}
