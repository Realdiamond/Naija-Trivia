/**
 * Email for sign-in codes (build plan step 2.10): Resend, whose free plan sends 100 a day.
 * Outside production with no key set, codes go to the log instead (DevEmail), so sign-in works
 * locally without an account.
 */
import type { FastifyBaseLogger } from 'fastify';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  /** Sends the email and returns the name of the provider that took it; throws if it did not. */
  send(email: OutgoingEmail): Promise<string>;
}

type Fetch = typeof fetch;

export class ResendEmail implements EmailSender {
  constructor(private readonly options: { apiKey: string; from: string; fetch?: Fetch }) {}

  async send(email: OutgoingEmail): Promise<string> {
    const res = await (this.options.fetch ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    // 429 is the plan's daily limit (or too many at once): the code is not sent and not counted.
    if (!res.ok) throw new Error(`resend answered ${res.status}`);
    return 'resend';
  }
}

/** `chidi.okeke@gmail.com` → `c•••@gmail.com`, for logs and staff. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${address[0]}•••${address.slice(at)}`;
}

/** Development and tests: no email leaves the machine; it is logged and kept. */
export class DevEmail implements EmailSender {
  readonly outbox: OutgoingEmail[] = [];

  constructor(private readonly log?: FastifyBaseLogger) {}

  async send(email: OutgoingEmail): Promise<string> {
    this.outbox.push(email);
    this.log?.info({ to: maskEmail(email.to), text: email.text }, 'Email not sent (development): here it is');
    return 'dev';
  }
}
