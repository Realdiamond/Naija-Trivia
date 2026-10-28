import { describe, expect, it } from 'vitest';
import type { AdminTimelineEvent } from '@whosabi/shared-types';
import { describeEvent, duration, groupSessions, watDateTime } from './format';

const ev = (
  event: string,
  ts: string,
  session = 's1',
  props: Record<string, unknown> = {},
): AdminTimelineEvent => ({
  event_id: `${event}-${ts}`,
  event,
  source: 'client',
  ts,
  session_id: session,
  platform: 'web',
  app_version: '1.0.0',
  screen: '',
  props,
});

describe('format', () => {
  it('shows durations the way the mockups do', () => {
    expect(duration(4_200)).toBe('4.2 s');
    expect(duration(45_000)).toBe('45 s');
    expect(duration(372_000)).toBe('6 min 12 s');
    expect(duration(1_500_000)).toBe('25 min');
    expect(duration(3_900_000)).toBe('1 h 5 min');
    expect(duration(-1)).toBe('—');
  });

  it('shows times in WAT', () => {
    expect(watDateTime('2026-10-28T13:32:00Z')).toBe('28 Oct 2026, 14:32');
    expect(watDateTime(null)).toBe('—');
  });

  it('describes events in plain words', () => {
    expect(
      describeEvent({
        event: 'question_answered',
        platform: 'web',
        props: {
          correct: true,
          timed_out: false,
          accepted_elapsed_ms: 2100,
          points: 186,
          category: 'nollywood',
          mode: 'duel',
        },
      }),
    ).toBe('Correct in 2.1 s · +186 · nollywood (duel)');
    expect(
      describeEvent({ event: 'app_backgrounded', platform: 'android', props: { foreground_ms: 372_000 } }),
    ).toBe('Left the app · 6 min 12 s in view');
    expect(
      describeEvent({
        event: 'daily_completed',
        platform: 'web',
        props: { daily_id: 142, score: 1310, streak: 12 },
      }),
    ).toBe('Finished Daily #142 · 1310 points · 12-day streak');
    expect(describeEvent({ event: 'something_new', platform: 'web', props: { a: 1 } })).toBe(
      'something_new {"a":1}',
    );
  });

  it('groups a newest-first list into sessions, each oldest first', () => {
    const groups = groupSessions([
      ev('app_backgrounded', '2026-11-01T09:05:00Z', 's2'),
      ev('screen_viewed', '2026-11-01T09:01:00Z', 's2'),
      ev('question_answered', '2026-11-01T09:00:30Z', ''),
      ev('session_started', '2026-11-01T09:00:00Z', 's2'),
      ev('session_started', '2026-11-01T08:00:00Z', 's1'),
    ]);
    expect(groups.map((g) => [g.sessionId, g.events.map((e) => e.event)])).toEqual([
      ['s2', ['session_started', 'question_answered', 'screen_viewed', 'app_backgrounded']],
      ['s1', ['session_started']],
    ]);
    expect(groups[0]).toMatchObject({ start: '2026-11-01T09:00:00Z', end: '2026-11-01T09:05:00Z' });
  });
});
