/**
 * SMS for sign-in codes (TRD §3 and §8): Termii first, Africa's Talking when Termii fails.
 * Outside production with no keys set, codes go to the log instead (DevSms), so sign-in works
 * locally without an SMS account. Doc 10 §5: OTP only, on a transactional route.
 */
import type { FastifyBaseLogger } from 'fastify';
import { maskPhone } from '@whosabi/shared-types';

export interface SmsSender {
  /** Sends the text and returns the name of the provider that took it; throws if none did. */
  send(to: string, text: string): Promise<string>;
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 10_000;

/** Termii's DND (transactional) route reaches numbers on the Do-Not-Disturb list. */
export class TermiiSms implements SmsSender {
  constructor(
    private readonly options: { apiKey: string; senderId: string; fetch?: Fetch; baseUrl?: string },
  ) {}

  async send(to: string, text: string): Promise<string> {
    const res = await (this.options.fetch ?? fetch)(
      `${this.options.baseUrl ?? 'https://api.ng.termii.com'}/api/sms/send`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: this.options.apiKey,
          to: to.replace(/^\+/, ''),
          from: this.options.senderId,
          sms: text,
          type: 'plain',
          channel: 'dnd',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`termii answered ${res.status}`);
    return 'termii';
  }
}

export class AfricasTalkingSms implements SmsSender {
  constructor(
    private readonly options: { username: string; apiKey: string; senderId?: string; fetch?: Fetch },
  ) {}

  async send(to: string, text: string): Promise<string> {
    const form = new URLSearchParams({ username: this.options.username, to, message: text });
    if (this.options.senderId) form.set('from', this.options.senderId);
    const res = await (this.options.fetch ?? fetch)('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        apiKey: this.options.apiKey,
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`africastalking answered ${res.status}`);
    const body = (await res.json()) as { SMSMessageData?: { Recipients?: Array<{ statusCode?: number }> } };
    // 100 processed, 101 sent, 102 queued; anything else was refused.
    const status = body.SMSMessageData?.Recipients?.[0]?.statusCode;
    if (status === undefined || ![100, 101, 102].includes(status)) {
      throw new Error(`africastalking refused the message (status ${status})`);
    }
    return 'africastalking';
  }
}

/** Tries each provider in turn, so one network or provider outage doesn't stop sign-ins. */
export class FailoverSms implements SmsSender {
  constructor(
    private readonly senders: SmsSender[],
    private readonly log: FastifyBaseLogger,
  ) {}

  async send(to: string, text: string): Promise<string> {
    let lastError: unknown;
    for (const sender of this.senders) {
      try {
        return await sender.send(to, text);
      } catch (err) {
        lastError = err;
        this.log.warn({ err, to: maskPhone(to) }, 'SMS provider failed; trying the next one');
      }
    }
    throw lastError ?? new Error('no SMS provider configured');
  }
}

/** Development and tests: no SMS leaves the machine; the message is logged and kept. */
export class DevSms implements SmsSender {
  readonly outbox: Array<{ to: string; text: string }> = [];

  constructor(private readonly log?: FastifyBaseLogger) {}

  async send(to: string, text: string): Promise<string> {
    this.outbox.push({ to, text });
    this.log?.info({ to: maskPhone(to), text }, 'SMS not sent (development): here is the message');
    return 'dev';
  }
}
