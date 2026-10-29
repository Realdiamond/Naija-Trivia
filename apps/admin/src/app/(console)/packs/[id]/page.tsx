/** One pack (step 2.8f): its details, and the questions chosen for it. */
import Link from 'next/link';
import { routes, type AdminPackDetail, type AdminProfile } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../../lib/api';
import { CATEGORY_NAME, STATUS_LABEL, STATUS_TONE } from '../../../../lib/content';
import { removeQuestion } from '../actions';
import { AddQuestions, PackForm } from '../Forms';
import { accessLine, packState } from '../format';

export default async function Pack({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail: AdminPackDetail;
  let me: AdminProfile;
  try {
    [me, detail] = await Promise.all([
      adminApi<AdminProfile>('/admin/me'),
      adminApi<AdminPackDetail>(routes.admin.pack(id)),
    ]);
  } catch (e) {
    return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load the pack.'}</p>;
  }
  const { pack, questions } = detail;
  const canEdit = me.permissions.includes('content.publish');
  const state = packState(pack, Date.now());
  return (
    <>
      <div>
        <Link href="/packs" className="small">
          ← Packs
        </Link>
        <h1>{pack.title}</h1>
        <p className="muted">
          {accessLine(pack)} · {pack.live} live questions ·{' '}
          <span className={`badge ${state.tone}`} data-testid="pack-state">
            {state.label}
          </span>
        </p>
      </div>
      <section className="card">
        <h2>Details</h2>
        <PackForm pack={pack} canEdit={canEdit} />
      </section>
      <section className="card">
        <h2>Questions chosen for it</h2>
        {pack.category_id ? (
          <p className="muted small">
            It also holds every live question in {CATEGORY_NAME[pack.category_id] ?? pack.category_id}.
          </p>
        ) : null}
        {canEdit ? <AddQuestions packId={pack.id} /> : null}
        {questions.length === 0 ? (
          <p className="muted small">None chosen yet.</p>
        ) : (
          <table data-testid="pack-questions">
            <thead>
              <tr>
                <th>Question</th>
                <th>Category</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.id} data-testid={`pack-question-${q.id}`}>
                  <td>
                    <Link href={`/questions/${q.id}`}>{q.text}</Link>
                    <div className="muted small">{q.external_ref ?? q.id}</div>
                  </td>
                  <td>{CATEGORY_NAME[q.category_id] ?? q.category_id}</td>
                  <td>
                    <span className={`badge ${STATUS_TONE[q.status as keyof typeof STATUS_TONE] ?? ''}`}>
                      {STATUS_LABEL[q.status as keyof typeof STATUS_LABEL] ?? q.status}
                    </span>
                  </td>
                  <td>
                    {canEdit ? (
                      <form action={removeQuestion.bind(null, pack.id, q.id)}>
                        <button type="submit" className="small danger">
                          Take out
                        </button>
                      </form>
                    ) : null}
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
