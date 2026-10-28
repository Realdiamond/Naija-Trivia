/**
 * The question bank (doc 18 §12): every question by where it is in the workflow, with how it
 * plays. Writers see their own; editors can publish approved questions in a batch.
 */
import Link from 'next/link';
import type { AdminProfile, AdminQuestionListResponse, QuestionStatus } from '@whosabi/shared-types';
import { adminApi } from '../../../lib/api';
import { CATEGORY_NAME, percent, STATUS_LABEL, STATUS_TONE } from '../../../lib/content';
import { watDateTime } from '../../../lib/format';
import { PublishTable } from './PublishTable';

const ORDER: QuestionStatus[] = ['in_review', 'approved', 'live', 'draft', 'suspended', 'retired'];

interface Search {
  status?: string;
  category?: string;
  q?: string;
  cursor?: string;
}

export default async function Questions({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const status = ORDER.includes(search.status as QuestionStatus)
    ? (search.status as QuestionStatus)
    : 'in_review';
  const category = search.category && CATEGORY_NAME[search.category] ? search.category : '';
  const q = (search.q ?? '').trim();
  const query = new URLSearchParams({ status, limit: '50' });
  if (category) query.set('category', category);
  if (q) query.set('q', q);
  if (search.cursor) query.set('cursor', search.cursor);
  const [me, page] = await Promise.all([
    adminApi<AdminProfile>('/admin/me'),
    adminApi<AdminQuestionListResponse>(`/admin/questions?${query}`),
  ]);
  const link = (over: Partial<Search>) => {
    const params = new URLSearchParams();
    const next = { status, category, q, ...over };
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    return `/questions?${params}`;
  };
  const canPublish = me.permissions.includes('content.publish');

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Questions</h1>
        <div className="row">
          {me.permissions.includes('content.import') ? (
            <Link className="button" href="/import">
              Import a CSV
            </Link>
          ) : null}
          {me.permissions.includes('content.write') ? (
            <Link className="button primary" href="/questions/new" data-testid="new-question">
              New question
            </Link>
          ) : null}
        </div>
      </div>

      <nav className="tabs" aria-label="Status">
        {ORDER.map((s) => (
          <Link
            key={s}
            href={link({ status: s, cursor: undefined })}
            aria-current={s === status ? 'page' : undefined}
          >
            {STATUS_LABEL[s]} <span className="muted">{page.counts[s].toLocaleString('en-NG')}</span>
          </Link>
        ))}
      </nav>

      <form action="/questions" className="inline" role="search">
        <input type="hidden" name="status" value={status} />
        <label>
          Category
          <select name="category" defaultValue={category}>
            <option value="">All categories</option>
            {Object.entries(CATEGORY_NAME).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1 }}>
          Words or id
          <input name="q" defaultValue={q} placeholder="e.g. Wedding Party, or SPT-0007" />
        </label>
        <button type="submit">Filter</button>
      </form>

      <div className="card">
        {page.questions.length === 0 ? (
          <p className="muted">No {STATUS_LABEL[status].toLowerCase()} questions here.</p>
        ) : status === 'approved' && canPublish ? (
          <PublishTable rows={page.questions} />
        ) : (
          <table data-testid="question-list">
            <thead>
              <tr>
                <th>Question</th>
                <th>Category</th>
                <th>Difficulty</th>
                <th>Plays</th>
                <th>Right</th>
                <th>Reports</th>
                <th>Changed</th>
              </tr>
            </thead>
            <tbody>
              {page.questions.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/questions/${r.id}`}>{r.text}</Link>
                    <div className="mono muted">
                      {r.external_ref ?? r.id}
                      {r.author ? ` · ${r.author}` : ''}
                    </div>
                  </td>
                  <td>{CATEGORY_NAME[r.category_id] ?? r.category_id}</td>
                  <td>{r.difficulty}</td>
                  <td>{r.plays.toLocaleString('en-NG')}</td>
                  <td>{percent(r.correct_rate)}</td>
                  <td>
                    {r.open_reports > 0 ? (
                      <span className={`badge ${STATUS_TONE.suspended}`}>{r.open_reports}</span>
                    ) : (
                      '0'
                    )}
                  </td>
                  <td>{watDateTime(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {page.next_cursor ? <Link href={link({ cursor: page.next_cursor })}>Next page →</Link> : null}
    </>
  );
}
