/**
 * Server-authoritative answer timing with latency tolerance (TRD §5.3).
 *
 * The client reports how long the question was visible before the tap. The server
 * only trusts that figure within a window built from its own clock and the
 * session's round-trip estimate, so a slow network never costs a player points and
 * a faked fast time never earns them.
 */

/** Fastest answer we accept from a human. */
export const MIN_HUMAN_ELAPSED_MS = 300;
/** How much faster than (server elapsed − RTT) the client may claim to be. */
export const CLIENT_CLAMP_SLACK_MS = 250;
/** Answers arriving later than time limit + RTT + this are timeouts. */
export const LATE_ANSWER_GRACE_MS = 2000;
/**
 * Duels only (TRD FR-DUEL-5): after a network drop the app re-sends the answer it kept. One
 * that arrives within the time limit + this, tapped in time, still counts, with no speed bonus.
 */
export const OFFLINE_RESEND_GRACE_MS = 10_000;

export interface ElapsedInput {
  /** What the client measured from the question becoming visible to the tap. Missing → server view. */
  clientElapsedMs: number | null | undefined;
  /** Server receive time minus serve time. */
  serverElapsedMs: number;
  /** Round-trip estimate for the session. */
  rttEstMs: number;
  timeLimitMs: number;
  /** Accept re-sent answers up to the time limit + this (OFFLINE_RESEND_GRACE_MS in duels). */
  offlineGraceMs?: number;
}

export interface ElapsedResult {
  /** The time used for scoring, between MIN_HUMAN_ELAPSED_MS and the time limit. */
  acceptedMs: number;
  /** True when the answer arrived too late to count. */
  timedOut: boolean;
}

export function acceptElapsed(input: ElapsedInput): ElapsedResult {
  const { serverElapsedMs, rttEstMs, timeLimitMs } = input;
  assertNonNegative('serverElapsedMs', serverElapsedMs);
  assertNonNegative('rttEstMs', rttEstMs);
  if (!(timeLimitMs > 0)) throw new RangeError(`timeLimitMs must be positive, got ${timeLimitMs}`);

  const client = input.clientElapsedMs;
  if (serverElapsedMs > timeLimitMs + rttEstMs + LATE_ANSWER_GRACE_MS) {
    const tappedInTime = typeof client === 'number' && client >= 0 && client <= timeLimitMs;
    const resent = serverElapsedMs <= timeLimitMs + (input.offlineGraceMs ?? 0);
    // Scored at the limit, so a late re-send can never earn speed points.
    return { acceptedMs: timeLimitMs, timedOut: !(tappedInTime && resent) };
  }

  const lower = Math.max(0, serverElapsedMs - rttEstMs - CLIENT_CLAMP_SLACK_MS);
  const upper = serverElapsedMs;
  const claimed = typeof client === 'number' && Number.isFinite(client) && client >= 0 ? client : upper;
  const clamped = Math.min(Math.max(claimed, lower), upper);
  const accepted = Math.min(Math.max(clamped, MIN_HUMAN_ELAPSED_MS), timeLimitMs);
  return { acceptedMs: Math.round(accepted), timedOut: false };
}

function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative number, got ${value}`);
}
