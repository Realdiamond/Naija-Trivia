import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateDuelResponse, PingResponse, ServedQuestion } from '@whosabi/shared-types';
import { bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const headers = (access: string, session = 's_rtt_test') => ({ ...bearer(access), 'x-session-id': session });

async function sample(access: string, rttMs: number, session?: string) {
  const ping = (
    await t.app.inject({ method: 'POST', url: '/v1/ping', headers: headers(access, session) })
  ).json() as PingResponse;
  t.clock.advance(rttMs);
  return t.app.inject({ method: 'POST', url: `/v1/ping/${ping.ping_id}`, headers: headers(access, session) });
}

describe('round-trip sampling (TRD §5.3)', () => {
  it('measures each ping on the server and estimates from the median of the last 5', async () => {
    const guest = await signInGuest(t.app);
    expect((await sample(guest.access, 180)).json()).toEqual({ rtt_ms: 180, rtt_est_ms: 180 });
    await sample(guest.access, 220);
    expect((await sample(guest.access, 2600)).json()).toEqual({ rtt_ms: 2600, rtt_est_ms: 220 });
    for (let i = 0; i < 5; i++) await sample(guest.access, 5000);
    expect((await sample(guest.access, 5000)).json().rtt_est_ms).toBe(1500);
  });

  it('counts each ping once, for the player and session that asked for it', async () => {
    const guest = await signInGuest(t.app);
    const other = await signInGuest(t.app);
    const ping = (
      await t.app.inject({ method: 'POST', url: '/v1/ping', headers: headers(guest.access) })
    ).json() as PingResponse;
    const pong = (access: string, session?: string) =>
      t.app.inject({ method: 'POST', url: `/v1/ping/${ping.ping_id}`, headers: headers(access, session) });
    expect((await pong(other.access)).statusCode).toBe(404);
    // A wrong claim used the ping up, so the real answer is refused too: no retrying for a better number.
    expect((await pong(guest.access)).statusCode).toBe(404);
    const second = (
      await t.app.inject({ method: 'POST', url: '/v1/ping', headers: headers(guest.access) })
    ).json() as PingResponse;
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: `/v1/ping/${second.ping_id}`,
          headers: headers(guest.access, 's_other'),
        })
      ).statusCode,
    ).toBe(404);
  });

  it("uses the session's estimate when timing a duel answer", async () => {
    const guest = await signInGuest(t.app);
    for (let i = 0; i < 3; i++) await sample(guest.access, 1000);
    const { duel } = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/duels',
        headers: headers(guest.access),
        payload: { opponent: { link: true } },
      })
    ).json() as CreateDuelResponse;
    const offered = duel.next?.action === 'pick_category' ? duel.next.offered : [];
    await t.app.inject({
      method: 'POST',
      url: `/v1/duels/${duel.id}/rounds/1/category`,
      headers: headers(guest.access),
      payload: { category_id: offered[0] },
    });
    const q = (
      await t.app.inject({
        method: 'POST',
        url: `/v1/duels/${duel.id}/rounds/1/questions/1/serve`,
        headers: headers(guest.access),
      })
    ).json() as ServedQuestion;
    t.clock.advance(5000);
    await t.app.inject({
      method: 'POST',
      url: `/v1/duels/${duel.id}/rounds/1/questions/1/answer`,
      headers: headers(guest.access),
      payload: { display_index: 0, client_elapsed_ms: 3000 },
    });
    // The client may claim at most RTT + 250 ms faster than the server saw: 5000 − 1000 − 250.
    const row = (
      await t.pool.query(
        'SELECT rtt_est_ms, accepted_elapsed_ms FROM duel_answers WHERE duel_id = $1 AND question_id = $2',
        [duel.id, q.qid],
      )
    ).rows[0];
    expect(row).toEqual({ rtt_est_ms: 1000, accepted_elapsed_ms: 3750 });
  });
});
