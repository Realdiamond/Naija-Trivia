import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { acceptElapsed, CLIENT_CLAMP_SLACK_MS, MIN_HUMAN_ELAPSED_MS } from '../src/timing';

const LIMIT = 15_000;

describe('acceptElapsed', () => {
  it('trusts an honest client inside the latency window', () => {
    expect(
      acceptElapsed({ clientElapsedMs: 4210, serverElapsedMs: 4500, rttEstMs: 400, timeLimitMs: LIMIT }),
    ).toEqual({
      acceptedMs: 4210,
      timedOut: false,
    });
  });

  it('TC-T1: a client claiming 200 ms when the server saw 4,000 ms is pulled up', () => {
    const rtt = 300;
    const { acceptedMs } = acceptElapsed({
      clientElapsedMs: 200,
      serverElapsedMs: 4000,
      rttEstMs: rtt,
      timeLimitMs: LIMIT,
    });
    expect(acceptedMs).toBe(4000 - rtt - CLIENT_CLAMP_SLACK_MS);
  });

  it('never accepts more than the server measured', () => {
    expect(
      acceptElapsed({ clientElapsedMs: 9000, serverElapsedMs: 5000, rttEstMs: 200, timeLimitMs: LIMIT })
        .acceptedMs,
    ).toBe(5000);
  });

  it('TC-T2: an answer at limit + RTT + 2.1 s is a timeout', () => {
    const r = acceptElapsed({
      clientElapsedMs: 14_900,
      serverElapsedMs: LIMIT + 400 + 2100,
      rttEstMs: 400,
      timeLimitMs: LIMIT,
    });
    expect(r.timedOut).toBe(true);
  });

  it('accepts a late answer inside the grace window but with no speed left', () => {
    const r = acceptElapsed({
      clientElapsedMs: 15_500,
      serverElapsedMs: 16_000,
      rttEstMs: 400,
      timeLimitMs: LIMIT,
    });
    expect(r).toEqual({ acceptedMs: LIMIT, timedOut: false });
  });

  it('floors at the human minimum', () => {
    expect(
      acceptElapsed({ clientElapsedMs: 50, serverElapsedMs: 120, rttEstMs: 80, timeLimitMs: LIMIT })
        .acceptedMs,
    ).toBe(MIN_HUMAN_ELAPSED_MS);
  });

  it('falls back to the server view when the client value is missing or invalid', () => {
    for (const bad of [null, undefined, Number.NaN, -5]) {
      expect(
        acceptElapsed({ clientElapsedMs: bad, serverElapsedMs: 6000, rttEstMs: 300, timeLimitMs: LIMIT })
          .acceptedMs,
      ).toBe(6000);
    }
  });

  it('always lands between the human minimum and the time limit', () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: -1000, max: 60_000 })),
        fc.integer({ min: 0, max: 60_000 }),
        fc.integer({ min: 0, max: 5000 }),
        (client, server, rtt) => {
          const r = acceptElapsed({
            clientElapsedMs: client,
            serverElapsedMs: server,
            rttEstMs: rtt,
            timeLimitMs: LIMIT,
          });
          expect(r.acceptedMs).toBeGreaterThanOrEqual(MIN_HUMAN_ELAPSED_MS);
          expect(r.acceptedMs).toBeLessThanOrEqual(LIMIT);
          if (!r.timedOut) expect(r.acceptedMs).toBeLessThanOrEqual(Math.max(server, MIN_HUMAN_ELAPSED_MS));
        },
      ),
    );
  });

  it('rejects impossible inputs', () => {
    expect(() =>
      acceptElapsed({ clientElapsedMs: 1, serverElapsedMs: -1, rttEstMs: 0, timeLimitMs: LIMIT }),
    ).toThrow(RangeError);
    expect(() =>
      acceptElapsed({ clientElapsedMs: 1, serverElapsedMs: 1, rttEstMs: 0, timeLimitMs: 0 }),
    ).toThrow(RangeError);
  });
});
