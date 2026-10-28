/**
 * Push notifications (TRD §4.8, FR-NOT-1 to FR-NOT-3). FCM and web push arrive in build plan
 * step 2.5; until then the stand-in writes each message to the log.
 */
import type { FastifyBaseLogger } from 'fastify';

export type PushType =
  | 'your_turn'
  | 'duel_expiring'
  | 'duel_result'
  | 'friend_joined'
  | 'daily_live'
  | 'league_recap'
  | 'party_invite'
  | 'content_correction';

export interface PushMessage {
  type: PushType;
  title: string;
  body: string;
  /** What the app opens when the player taps it, e.g. { duel_id }. */
  data?: Record<string, string>;
}

export interface Notifier {
  /**
   * True once the push service has the message; false when nothing was sent (the stand-in).
   * Throws when the push service could not take it.
   */
  send(userId: string, message: PushMessage): Promise<boolean>;
}

export class LogNotifier implements Notifier {
  constructor(private readonly log: FastifyBaseLogger) {}

  async send(userId: string, message: PushMessage): Promise<boolean> {
    this.log.info(
      { to: userId, push: message },
      'push not sent (stand-in until step 2.5): here is the message',
    );
    return false;
  }
}

const WAT_OFFSET_MS = 3_600_000; // Africa/Lagos is UTC+1 all year

/** FR-NOT-2: no pushes from 22:00 to 07:00 WAT. */
export function inQuietHours(now: number): boolean {
  const hour = new Date(now + WAT_OFFSET_MS).getUTCHours();
  return hour >= 22 || hour < 7;
}
