import { describe, expect, it, vi } from 'vitest';
import { AfricasTalkingSms, FailoverSms, TermiiSms } from '../src/auth/sms';

const log = { warn: vi.fn() } as never;

function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return respond(String(url), init!);
  }) as typeof fetch;
  return { impl, calls };
}

describe('SMS providers', () => {
  it("sends through Termii's transactional (DND) route", async () => {
    const net = fakeFetch(() => new Response('{"message_id":"1"}', { status: 200 }));
    const sms = new TermiiSms({ apiKey: 'k', senderId: 'WhoSabi', fetch: net.impl });
    expect(await sms.send('+2348031234567', 'hello')).toBe('termii');
    expect(net.calls[0]!.url).toBe('https://api.ng.termii.com/api/sms/send');
    expect(JSON.parse(String(net.calls[0]!.init.body))).toEqual({
      api_key: 'k',
      to: '2348031234567',
      from: 'WhoSabi',
      sms: 'hello',
      type: 'plain',
      channel: 'dnd',
    });
  });

  it("checks Africa's Talking's per-recipient status, not just the HTTP status", async () => {
    const accepted = fakeFetch(
      () => new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 101 }] } })),
    );
    const sms = new AfricasTalkingSms({ username: 'u', apiKey: 'k', fetch: accepted.impl });
    expect(await sms.send('+2348031234567', 'hello')).toBe('africastalking');
    const form = new URLSearchParams(String(accepted.calls[0]!.init.body));
    expect(Object.fromEntries(form)).toEqual({ username: 'u', to: '+2348031234567', message: 'hello' });

    const refused = fakeFetch(
      () => new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 403 }] } })),
    );
    await expect(
      new AfricasTalkingSms({ username: 'u', apiKey: 'k', fetch: refused.impl }).send('+2348031234567', 'x'),
    ).rejects.toThrow(/refused/);
  });

  it('falls back to the next provider, and fails only when all do', async () => {
    const down = fakeFetch(() => new Response('', { status: 502 }));
    const up = fakeFetch(
      () => new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 101 }] } })),
    );
    const termii = new TermiiSms({ apiKey: 'k', senderId: 'WhoSabi', fetch: down.impl });
    const at = new AfricasTalkingSms({ username: 'u', apiKey: 'k', fetch: up.impl });
    expect(await new FailoverSms([termii, at], log).send('+2348031234567', 'x')).toBe('africastalking');
    await expect(
      new FailoverSms([termii, new TermiiSms({ apiKey: 'k', senderId: 'S', fetch: down.impl })], log).send(
        '+2348031234567',
        'x',
      ),
    ).rejects.toThrow(/termii answered 502/);
  });
});
