/**
 * How the console shows times and events. WAT everywhere, UTC on hover (doc 18 §17); the
 * timeline reads like the User 360 mockup: "Q1 correct in 2.1 s · +186".
 */
import type { AdminTimelineEvent } from '@whosabi/shared-types';

const WAT = 'Africa/Lagos';

export function watDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: WAT,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function watTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: WAT,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

// Shared with the Staff tab in the app (step 2.9a).
export { describeEvent, duration } from '@whosabi/shared-types';

export interface SessionGroup {
  sessionId: string;
  platform: string;
  appVersion: string;
  start: string;
  end: string;
  /** Oldest first, as the session happened. */
  events: AdminTimelineEvent[];
}

/** Events (newest first, as the API sends them) into sessions, newest session first. */
export function groupSessions(events: readonly AdminTimelineEvent[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  for (const event of events) {
    const last = groups.at(-1);
    // Server events can lack a session; they join the session around them.
    if (last && (event.session_id === last.sessionId || !event.session_id)) {
      last.events.unshift(event);
      last.start = event.ts;
      continue;
    }
    groups.push({
      sessionId: event.session_id,
      platform: event.platform,
      appVersion: event.app_version,
      start: event.ts,
      end: event.ts,
      events: [event],
    });
  }
  return groups;
}
