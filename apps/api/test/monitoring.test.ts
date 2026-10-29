/**
 * Error reports (build plan step 2.8e): a 500 goes to Sentry with the request id, the route
 * pattern and the player's pseudonymous id, and nothing from the request itself; errors players
 * are meant to see don't go at all.
 */
import * as Sentry from '@sentry/node';
import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import { ErrorCode } from '@whosabi/shared-types';
import { ApiError, registerErrorHandlers } from '../src/errors';
import { reportError, startMonitoring } from '../src/monitoring';

const KEY = 'k'.repeat(40);
const sent: Sentry.Event[] = [];
const transport = () => ({
  send: async (envelope: unknown) => {
    for (const [header, item] of (envelope as [unknown, [{ type: string }, unknown][]])[1]) {
      if (header.type === 'event') sent.push(item as Sentry.Event);
    }
    return {};
  },
  flush: async () => true,
});

afterAll(() => Sentry.close());

describe('error reports (step 2.8e)', () => {
  it('stay off without a DSN', () => {
    expect(startMonitoring({ env: 'test', analyticsKey: KEY }, 'api')).toBe(false);
  });

  it('send unexpected errors only, with nothing personal', async () => {
    expect(
      startMonitoring(
        {
          sentryDsn: 'https://public@sentry.example.com/1',
          env: 'test',
          release: 'abc1234',
          analyticsKey: KEY,
        },
        'api',
        transport as unknown as Sentry.NodeOptions['transport'],
      ),
    ).toBe(true);
    const app = Fastify({ genReqId: () => 'req_test_1' });
    registerErrorHandlers(app);
    app.decorateRequest('auth', null);
    app.addHook('onRequest', async (request) => {
      request.auth = { userId: 'u_reporter', platform: 'android', guest: false };
    });
    app.post('/v1/duels/:id/boom', async () => {
      throw new Error('the database went away');
    });
    app.get('/v1/expected', async () => {
      throw new ApiError(409, ErrorCode.conflict, 'It is not your turn');
    });

    const boom = await app.inject({
      method: 'POST',
      url: '/v1/duels/d_123/boom?phone=08031234567',
      headers: { authorization: 'Bearer secret-token', cookie: 'refresh=secret' },
      payload: { phone: '08031234567' },
    });
    expect(boom.statusCode).toBe(500);
    expect((await app.inject({ method: 'GET', url: '/v1/expected' })).statusCode).toBe(409);
    reportError(new Error('a job broke'), { job: 'push-send' });
    await Sentry.flush(1000);

    expect(sent).toHaveLength(2);
    const [request, job] = sent;
    expect(request!.exception?.values?.[0]?.value).toBe('the database went away');
    expect(request!.tags).toMatchObject({
      service: 'api',
      request_id: 'req_test_1',
      route: '/v1/duels/:id/boom',
      method: 'POST',
    });
    expect(request!.user).toEqual({ id: pseudonymousId('u_reporter', KEY) });
    expect(request!.release).toBe('abc1234');
    const raw = JSON.stringify(sent);
    for (const secret of ['08031234567', 'secret-token', 'refresh=secret', 'u_reporter', 'd_123']) {
      expect(raw).not.toContain(secret);
    }
    expect(job!.tags).toMatchObject({ job: 'push-send' });
    await app.close();
  });
});
