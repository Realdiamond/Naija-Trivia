/** A push service stand-in for tests: records what reaches each phone, and can fail on cue. */
import { randomBytes } from 'node:crypto';
import { newId } from '../src/ids';
import {
  INVALID_TOKEN,
  PushRejected,
  type DeviceToken,
  type OutgoingPush,
  type PushTransport,
} from '../src/push/transport';

type Failure = 'transient' | 'refused' | 'invalid';

export class TestTransport implements PushTransport {
  readonly real = true;
  sent: Array<{ device: DeviceToken; push: OutgoingPush }> = [];
  private failures = new Map<string, Failure>();

  /** The next push to this token fails this way. */
  failNext(token: string, failure: Failure) {
    this.failures.set(token, failure);
  }

  async send(device: DeviceToken, push: OutgoingPush) {
    const failure = this.failures.get(device.token);
    this.failures.delete(device.token);
    if (failure === 'invalid') return INVALID_TOKEN;
    if (failure === 'refused') throw new PushRejected('refused in a test');
    if (failure === 'transient') throw new Error('push service down in a test');
    this.sent.push({ device, push });
    return 'delivered' as const;
  }

  /** What reached the phone with this token. */
  to(token: string): OutgoingPush[] {
    return this.sent.filter((s) => s.device.token === token).map((s) => s.push);
  }
}

export const newPushToken = () => `fcm:${randomBytes(48).toString('base64url')}`;

/** Gives a player an Android phone with pushes on, straight in the database. Returns its token. */
export async function givePhone(
  pool: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  userId: string,
  token = newPushToken(),
): Promise<string> {
  await pool.query(
    `INSERT INTO devices (id, user_id, platform, push_token, last_seen_at, token_updated_at)
     VALUES ($1, $2, 'android', $3, now(), now())`,
    [newId('dev'), userId, token],
  );
  return token;
}
