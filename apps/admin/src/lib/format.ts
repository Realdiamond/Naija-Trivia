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

/** 372_000 → "6 min 12 s"; under a minute keeps one decimal below 10 s ("4.2 s"). */
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  return `${seconds} s`;
}

const num = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0));
const str = (value: unknown) => (value === undefined || value === null ? '' : String(value));

/** One line of the timeline. Unknown events fall back to their name and props. */
export function describeEvent(e: Pick<AdminTimelineEvent, 'event' | 'props' | 'platform'>): string {
  const p = e.props;
  switch (e.event) {
    case 'first_opened':
      return `Opened ${e.platform === 'web' ? 'the web app' : 'the app'} for the first time`;
    case 'session_started':
      return p.source === 'resume' ? 'Came back after a break' : 'Started a session';
    case 'app_foregrounded':
      return e.platform === 'web' ? 'Opened the site' : 'Opened the app';
    case 'app_backgrounded':
      return `Left ${e.platform === 'web' ? 'the site' : 'the app'} · ${duration(num(p.foreground_ms))} in view`;
    case 'screen_viewed':
      return p.prev_screen
        ? `${str(p.screen)} · after ${str(p.prev_screen)} ${duration(num(p.prev_screen_ms))}`
        : str(p.screen);
    case 'taste_test_completed':
      return `Taste test: ${num(p.correct_count)} of 3 right · ${num(p.score)} points`;
    case 'signup_completed':
      return `Signed up with ${str(p.method)}${p.merged_guest ? ', keeping their guest progress' : ''}`;
    case 'otp_sent':
      return `Sign-in code sent (${str(p.provider)})`;
    case 'otp_verified':
      return 'Sign-in code confirmed';
    case 'otp_failed':
      return `Sign-in code failed: ${str(p.reason)}`;
    case 'question_served':
      return `Question ${num(p.seq)} shown (${str(p.mode)})`;
    case 'question_answered': {
      const outcome = p.timed_out ? 'Time up' : p.correct ? 'Correct' : 'Wrong';
      return `${outcome} in ${duration(num(p.accepted_elapsed_ms))} · +${num(p.points)} · ${str(p.category)} (${str(p.mode)})`;
    }
    case 'duel_created':
      return `Started a duel (${str(p.opponent_type)})`;
    case 'duel_round_played':
      return `Played round ${num(p.round)} of duel ${str(p.duel_id)} · ${str(p.category)} · ${num(p.correct_count)} right · +${num(p.points)}`;
    case 'duel_completed': {
      const delta = num(p.rating_delta);
      return `Duel over: ${str(p.result)} ${num(p.score_self)}–${num(p.score_opp)} · rating ${delta >= 0 ? '+' : ''}${Math.round(delta)}`;
    }
    case 'daily_started':
      return `Started Daily #${num(p.daily_id)}`;
    case 'daily_completed':
      return `Finished Daily #${num(p.daily_id)} · ${num(p.score)} points · ${num(p.streak)}-day streak`;
    case 'daily_shared':
      return `Shared their Daily result (${str(p.channel)})`;
    case 'friend_added':
      return `Added a friend (${str(p.source)})`;
    case 'invite_shared':
      return `Shared a ${str(p.context)} link (${str(p.channel)})`;
    case 'invite_opened':
      return `Opened a ${str(p.type)} link in the ${str(p.opened_in).replace('_', ' ')}`;
    case 'consent_changed':
      return `${p.granted ? 'Allowed' : 'Refused'} ${str(p.purpose)}`;
    case 'push_sent':
      return `Push sent: ${str(p.type)}`;
    default: {
      const props = JSON.stringify(p);
      return props === '{}' ? e.event : `${e.event} ${props}`;
    }
  }
}

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
