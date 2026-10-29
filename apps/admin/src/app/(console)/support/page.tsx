/**
 * Support (doc 16 §3, doc 18 §13, build plan step 2.7p): what players wrote from the app's Help
 * screen, oldest open first, each with the player and their app. Answer in words the player
 * reads in the app, or by email from the helpdesk and mark it answered. Support, admins and owners.
 */
import Link from 'next/link';
import { routes, SUPPORT_MACROS, type AdminSupportQueue } from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { Ticket, TOPIC_LABEL } from './Ticket';

export default async function Support({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = (await searchParams).status === 'answered' ? 'answered' : 'open';
  let queue: AdminSupportQueue;
  try {
    queue = await adminApi<AdminSupportQueue>(routes.admin.support(status));
  } catch (e) {
    return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load support.'}</p>;
  }
  return (
    <>
      <div>
        <h1>Support</h1>
        <p className="muted">
          Messages from the app&apos;s Help screen, with the player&apos;s app and device.{' '}
          {queue.inbox
            ? 'Each one is emailed to the helpdesk too: answer there, or here for the player to read in the app.'
            : 'SUPPORT_INBOX is not set, so they are only here: answer here for the player to read in the app.'}{' '}
          First answer within 24 hours, a lost purchase within 4 in working hours (doc 16).
        </p>
      </div>
      <nav className="tabs">
        <Link href="/support" aria-current={status === 'open' ? 'page' : undefined} data-testid="tab-open">
          Open ({queue.open})
        </Link>
        <Link href="/support?status=answered" aria-current={status === 'answered' ? 'page' : undefined}>
          Answered
        </Link>
      </nav>
      {queue.tickets.length === 0 ? (
        <p className="muted">{status === 'open' ? 'Nothing waiting. Well done.' : 'Nothing answered yet.'}</p>
      ) : (
        <div className="stack" data-testid="tickets">
          {queue.tickets.map((t) => (
            <Ticket key={t.id} ticket={t} canAnswer />
          ))}
        </div>
      )}
      <section className="card">
        <h2>Ready answers</h2>
        <p className="muted small">
          For the common questions (doc 16 §3), in English and Pidgin: adapt them to the player. Grants and
          streak restores are on the player&apos;s page, within the limits.
        </p>
        <table>
          <tbody>
            {SUPPORT_MACROS.map((m) => (
              <tr key={m.title}>
                <td>
                  <b>{m.title}</b>
                  <div className="muted small">{TOPIC_LABEL[m.topic]}</div>
                </td>
                <td className="small">
                  {m.en}
                  <div className="muted">{m.pcm}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
