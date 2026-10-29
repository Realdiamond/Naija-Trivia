/**
 * One Daily (doc 18 §11, step 2.7f): exactly the seven questions players will get, easiest to
 * the boss, with the right answer, how each has done and when it was last in a Daily. Until
 * 22:00 WAT the day before, any question can be swapped for another that fits, with a reason.
 */
import Link from 'next/link';
import {
  routes,
  type AdminDailyCandidates,
  type AdminDailyDay,
  type AdminDailyQuestion,
} from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../../lib/api';
import { UseInstead } from '../Forms';

function Question({ q, slot }: { q: AdminDailyQuestion; slot?: number }) {
  return (
    <div className="stack daily-question">
      <p className="muted small">
        {slot ? `${slot === 7 ? 'Boss' : `Question ${slot}`} · ` : ''}
        {q.category} · level {q.difficulty}
        {q.correct_rate !== null
          ? ` · ${Math.round(q.correct_rate * 100)}% right in ${q.plays.toLocaleString('en-NG')} plays`
          : ' · not played yet'}
        {q.last_used ? ` · last Daily ${q.last_used}` : ''}
      </p>
      <b>{q.text}</b>
      <ol className="options">
        {q.options.map((o, i) => (
          <li key={i} className={i === q.correct_index ? 'right' : undefined}>
            {o}
            {i === q.correct_index ? ' ✓' : ''}
          </li>
        ))}
      </ol>
      {q.fact ? <p className="muted small">{q.fact}</p> : null}
    </div>
  );
}

export default async function DailyDay({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ slot?: string }>;
}) {
  const { date } = await params;
  const { slot: slotParam } = await searchParams;
  let day: AdminDailyDay;
  try {
    day = await adminApi<AdminDailyDay>(routes.admin.daily(date));
  } catch (e) {
    return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load this Daily.'}</p>;
  }
  const slot = Number(slotParam);
  const swapping = day.editable && slot >= 1 && slot <= 7 ? slot : null;
  const candidates = swapping
    ? await adminApi<AdminDailyCandidates>(routes.admin.dailyCandidates(date, swapping))
    : null;

  return (
    <>
      <p className="small">
        <Link href="/daily">Daily scheduler</Link> › {date}
      </p>
      <div>
        <h1>
          Daily #{day.id ?? '–'} · {date}
        </h1>
        <p className="muted">
          {day.editable
            ? 'Open to swaps until 22:00 WAT the day before. Players get the options in their own order.'
            : 'Fixed: everyone gets these questions.'}
        </p>
      </div>
      {day.questions.length === 0 ? <p className="muted">Not planned yet.</p> : null}
      {day.questions.map((q, i) => (
        <section key={q.id} className="card" data-testid={`slot-${i + 1}`}>
          <Question q={q} slot={i + 1} />
          {day.editable && swapping !== i + 1 ? (
            <Link className="button" href={`/daily/${date}?slot=${i + 1}`} data-testid={`swap-${i + 1}`}>
              Swap this question
            </Link>
          ) : null}
          {swapping === i + 1 && candidates ? (
            <div className="stack">
              <h3>Use instead</h3>
              {candidates.candidates.length === 0 ? (
                <p className="muted small">No other question fits.</p>
              ) : null}
              {candidates.candidates.map((c) => (
                <div key={c.id} className="candidate">
                  <Question q={c} />
                  <UseInstead date={date} slot={i + 1} questionId={c.id} />
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </>
  );
}
