/**
 * Packs (GDD §6.1, build plan step 2.8f): themed sets of questions players practise, offline too.
 * The six core packs are each a whole category; others are chosen by hand, free or unlocked with
 * coins. Everyone in Content sees them; editors make and change them.
 */
import Link from 'next/link';
import { routes, type AdminPacksResponse, type AdminProfile } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { CATEGORY_NAME } from '../../../lib/content';
import { watDateTime } from '../../../lib/format';
import { PackForm } from './Forms';
import { MIN_QUESTIONS, accessLine, packState } from './format';

export default async function Packs() {
  let page: AdminPacksResponse;
  let me: AdminProfile;
  try {
    [me, page] = await Promise.all([
      adminApi<AdminProfile>('/admin/me'),
      adminApi<AdminPacksResponse>(routes.admin.packs),
    ]);
  } catch (e) {
    return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load the packs.'}</p>;
  }
  const canEdit = me.permissions.includes('content.publish');
  const now = Date.now();
  return (
    <>
      <div>
        <h1>Packs</h1>
        <p className="muted">
          Players practise a pack on their phone, offline too: each week they get up to 50 of its questions
          with the answers, never one in a Daily. A pack shows once it has {MIN_QUESTIONS} live questions.
        </p>
      </div>
      <section className="card">
        <table data-testid="packs">
          <thead>
            <tr>
              <th>Pack</th>
              <th>Who can play</th>
              <th>Questions</th>
              <th>When</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {page.packs.map((pack) => {
              const state = packState(pack, now);
              return (
                <tr key={pack.id} data-testid={`pack-${pack.slug}`}>
                  <td>
                    <Link href={`/packs/${pack.id}`}>
                      <b>{pack.title}</b>
                    </Link>
                    {pack.description ? <div className="muted small">{pack.description}</div> : null}
                  </td>
                  <td>{accessLine(pack)}</td>
                  <td>
                    {pack.live} live
                    <div className="muted small">
                      {pack.category_id
                        ? `All of ${CATEGORY_NAME[pack.category_id] ?? pack.category_id}`
                        : null}
                      {pack.category_id && pack.chosen > 0 ? ' and ' : null}
                      {pack.chosen > 0 || !pack.category_id ? `${pack.chosen} chosen` : null}
                    </div>
                  </td>
                  <td className="small">
                    {pack.starts_at || pack.ends_at
                      ? `${watDateTime(pack.starts_at)} to ${watDateTime(pack.ends_at)}`
                      : 'Always'}
                  </td>
                  <td>
                    <span className={`badge ${state.tone}`}>{state.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {canEdit ? (
        <section className="card">
          <h2>New pack</h2>
          <PackForm canEdit />
        </section>
      ) : null}
    </>
  );
}
