'use client';
/** One message to support (step 2.7p), with the answer form and the ready answers (macros) to start from. */
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { SUPPORT_MACROS, type AdminSupportTicket } from '@whosabi/shared-types';
import { watDateTime } from '../../../lib/format';
import { answerTicket, answeredByEmail, reopenTicket, type FormState } from './actions';

const IDLE: FormState = { done: null, error: null };

export const TOPIC_LABEL: Record<AdminSupportTicket['topic'], string> = {
  purchase: 'Coins or a purchase',
  streak: 'Daily streak',
  question: 'A question or answer',
  account: 'Account or username',
  sign_in: 'Signing in',
  ban: 'A ban or warning',
  other: 'Something else',
};

export function Ticket({
  ticket,
  canAnswer,
  showPlayer = true,
}: {
  ticket: AdminSupportTicket;
  canAnswer: boolean;
  showPlayer?: boolean;
}) {
  const [state, action, pending] = useActionState(answerTicket.bind(null, ticket.id, ticket.user_id), IDLE);
  const [answer, setAnswer] = useState('');
  const macros = SUPPORT_MACROS.filter((m) => m.topic === ticket.topic || m.topic === 'other');
  return (
    <article className="card stack" data-testid={`ticket-${ticket.id}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{TOPIC_LABEL[ticket.topic]}</b>
        <span className={`badge ${ticket.status === 'open' ? 'warn' : ''}`}>
          {ticket.status === 'open' ? 'Open' : 'Answered'}
        </span>
      </div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{ticket.message}</p>
      <p className="muted small">
        {showPlayer ? (
          <>
            <Link href={`/players/${ticket.user_id}?tab=support`}>{ticket.player ?? 'A guest'}</Link> ·{' '}
          </>
        ) : null}
        {watDateTime(ticket.created_at)} · {ticket.platform}
        {ticket.app_version ? ` ${ticket.app_version}` : ''}
        {ticket.device ? ` · ${ticket.device}` : ''} ·{' '}
        {ticket.email ? `Reply to ${ticket.email}` : 'No email'} ·{' '}
        {ticket.emailed ? 'In the helpdesk' : 'Not emailed'}
      </p>
      {ticket.status === 'answered' ? (
        <>
          {ticket.answer ? (
            <blockquote data-testid="ticket-answer">{ticket.answer}</blockquote>
          ) : (
            <p className="muted small">Answered by email.</p>
          )}
          <p className="muted small">
            {ticket.answered_by ?? 'Staff'} · {watDateTime(ticket.answered_at)}
          </p>
          {canAnswer ? (
            <form action={reopenTicket.bind(null, ticket.id, ticket.user_id)}>
              <button type="submit" className="small">
                Open again
              </button>
            </form>
          ) : null}
        </>
      ) : canAnswer ? (
        <form action={action} className="stack">
          <label>
            Start from a ready answer
            <select
              defaultValue=""
              onChange={(e) => {
                const [i, lang] = e.target.value.split(':');
                const macro = macros[Number(i)];
                if (macro) setAnswer(lang === 'pcm' ? macro.pcm : macro.en);
              }}
              data-testid="macro"
            >
              <option value="">Choose…</option>
              {macros.flatMap((m, i) => [
                <option key={`${i}:en`} value={`${i}:en`}>
                  {m.title} (English)
                </option>,
                <option key={`${i}:pcm`} value={`${i}:pcm`}>
                  {m.title} (Pidgin)
                </option>,
              ])}
            </select>
          </label>
          <label>
            Answer (the player reads it in the app&apos;s Help screen)
            <textarea
              name="answer"
              rows={4}
              maxLength={2000}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              data-testid="answer"
            />
          </label>
          <div className="row">
            <button type="submit" className="primary" disabled={pending} data-testid="send-answer">
              Send the answer
            </button>
            <button
              type="submit"
              formAction={answeredByEmail.bind(null, ticket.id, ticket.user_id)}
              className="small"
            >
              Answered by email
            </button>
          </div>
          {state.error ? (
            <p className="error" role="alert">
              {state.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </article>
  );
}
