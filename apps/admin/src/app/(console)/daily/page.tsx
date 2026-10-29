/**
 * The Daily scheduler (doc 18 §11, build plan step 2.7f): the next 30 Dailies at a glance. Plan
 * the days not picked yet in one go; open a day to see exactly its questions and swap one until
 * 22:00 WAT the day before.
 */
import Link from 'next/link';
import { routes, type AdminDailyCalendar, type AdminDailyDay } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { PlanForm } from './Forms';

const weekday = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

function state(day: AdminDailyDay, today: string): { label: string; warn?: boolean } {
  if (!day.id) return { label: 'Not planned', warn: true };
  if (day.date === today) return { label: `Today · ${day.players.toLocaleString('en-NG')} played` };
  return day.editable ? { label: 'Open to swaps' } : { label: 'Fixed' };
}

export default async function DailyScheduler() {
  let calendar: AdminDailyCalendar;
  try {
    calendar = await adminApi<AdminDailyCalendar>(routes.admin.dailyCalendar());
  } catch (e) {
    return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load the Dailies.'}</p>;
  }
  const missing = calendar.days.filter((d) => !d.id).length;
  return (
    <>
      <div className="row spread">
        <div>
          <h1>Daily scheduler</h1>
          <p className="muted">
            The next 30 Dailies. {missing ? `${missing} not planned yet; ` : ''}Each day is fixed from 22:00
            WAT the day before.
          </p>
        </div>
      </div>
      <PlanForm />
      <section className="card">
        <table data-testid="daily-calendar">
          <thead>
            <tr>
              <th>Day</th>
              <th>Daily</th>
              <th>State</th>
              <th>Categories, easiest to the boss</th>
            </tr>
          </thead>
          <tbody>
            {calendar.days.map((day) => {
              const s = state(day, calendar.today);
              return (
                <tr key={day.date} data-testid={`day-${day.date}`}>
                  <td>
                    {day.id ? (
                      <Link href={`/daily/${day.date}`}>{weekday(day.date)}</Link>
                    ) : (
                      weekday(day.date)
                    )}
                  </td>
                  <td>{day.id ? `#${day.id}` : '–'}</td>
                  <td>
                    <span className={s.warn ? 'badge warn' : day.editable ? 'badge' : 'badge off'}>
                      {s.label}
                    </span>
                  </td>
                  <td className="small">{day.questions.map((q) => q.category).join(' · ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
