/**
 * One question (doc 04 §3): the editor, where it is in the workflow and what you may do with it,
 * the Question Bible checks, look-alikes, how it plays (doc 18 §9) and its history.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AdminQuestion } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../../lib/api';
import { CATEGORY_NAME, historyLabel, percent, STATUS_LABEL, STATUS_TONE } from '../../../../lib/content';
import { watDateTime } from '../../../../lib/format';
import { QuestionActions } from '../QuestionActions';
import { QuestionForm } from '../QuestionForm';

export default async function QuestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  let q: AdminQuestion;
  try {
    q = await adminApi<AdminQuestion>(`/admin/questions/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    throw e;
  }
  const { stats } = q;
  const totalPicks = stats.option_counts.reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="row">
        <Link href="/questions">← Questions</Link>
      </div>
      <div className="row">
        <h1>{q.external_ref ?? 'Question'}</h1>
        <span className={`badge ${STATUS_TONE[q.status]}`} data-testid="question-status">
          {STATUS_LABEL[q.status]}
        </span>
        <span className="muted small mono">
          {q.id} · version {q.version}
        </span>
      </div>
      {saved ? <p className="ok">Draft saved. Send it for review when it is ready.</p> : null}

      <div className="grid2">
        <div className="stack">
          {q.can_edit ? (
            <QuestionForm id={q.id} initial={q} />
          ) : (
            <div className="card stack">
              <p className="qtext">{q.text}</p>
              {q.type === 'closest_number' ? (
                <p>Answer: {q.numeric_answer}</p>
              ) : (
                <ol className="problems">
                  {q.options.map((o, i) => (
                    <li key={i}>
                      {o} {i === q.correct_index ? <span className="badge">right</span> : null}
                    </li>
                  ))}
                </ol>
              )}
              {q.fact ? <p className="muted">{q.fact}</p> : null}
              <p className="small muted">
                {CATEGORY_NAME[q.category_id]} · difficulty {q.difficulty} ·{' '}
                {q.source_url ? (
                  <a href={q.source_url} target="_blank" rel="noreferrer">
                    source
                  </a>
                ) : (
                  'no source'
                )}
              </p>
            </div>
          )}

          <div className="card stack">
            <h2>How it plays</h2>
            <div className="tiles">
              <div className="tile">
                Plays<b>{stats.plays.toLocaleString('en-NG')}</b>
              </div>
              <div className="tile">
                Right<b>{percent(stats.plays ? stats.correct / stats.plays : null)}</b>
              </div>
              <div className="tile">
                Average time
                <b>{stats.avg_elapsed_ms === null ? '—' : `${(stats.avg_elapsed_ms / 1000).toFixed(1)} s`}</b>
              </div>
              <div className="tile">
                Open reports<b>{q.open_reports}</b>
              </div>
              <div className="tile" title="Moves with every answer; sets the level from 200 plays">
                Difficulty rating<b>{Math.round(q.d_rating).toLocaleString('en-NG')}</b>
              </div>
            </div>
            {totalPicks > 0 ? (
              <div className="split" aria-label="Picks per option">
                {q.options.map((o, i) => {
                  const share = (stats.option_counts[i] ?? 0) / totalPicks;
                  return (
                    <div key={i} className="line">
                      <div>
                        {o}
                        <div className="bar">
                          <span
                            className={i === q.correct_index ? 'right' : ''}
                            style={{ width: `${share * 100}%` }}
                          />
                        </div>
                      </div>
                      <span>{percent(share)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="muted small">Nobody has played it yet.</p>
            )}
            {q.open_reports > 0 ? <Link href="/reports">See the reports</Link> : null}
          </div>
        </div>

        <div className="stack">
          <div className="card stack">
            <h2>Workflow</h2>
            <p className="small muted">
              {q.author ? `Written by ${q.author}` : 'From the question bank'}
              {q.reviewed_by ? ` · checked by ${q.reviewed_by}` : ''}
            </p>
            <QuestionActions id={q.id} actions={q.allowed_actions} />
          </div>

          <div className="card stack" data-testid="checks">
            <h2>Checks</h2>
            {q.checks.errors.length === 0 && q.checks.warnings.length === 0 ? (
              <p className="ok">Meets the Question Bible.</p>
            ) : null}
            {q.checks.errors.length > 0 ? (
              <ul className="problems errors">
                {q.checks.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            {q.checks.warnings.length > 0 ? (
              <ul className="problems">
                {q.checks.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            {q.similar.length > 0 ? (
              <>
                <p className="small">Reads like:</p>
                <ul className="problems">
                  {q.similar.map((s) => (
                    <li key={s.id}>
                      <Link href={`/questions/${s.id}`}>{s.text}</Link>{' '}
                      <span className="muted small">
                        {Math.round(s.similarity * 100)}% alike · {STATUS_LABEL[s.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <div className="card stack">
            <h2>History</h2>
            <ul className="history" data-testid="history">
              {q.history.map((h, i) => (
                <li key={i}>
                  <b>{historyLabel(h.action)}</b> · {h.actor}
                  <div className="muted small">
                    {watDateTime(h.at)} · version {h.version}
                  </div>
                  {h.note ? <div>{h.note}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
