/**
 * Staff sessions (doc 18 §16): a random token kept only as its hash, ending 12 hours after
 * sign-in however active the session is. Separate from player tokens, so a player token can
 * never open the console.
 *   adm:s:{sha256(token)}   the admin id, 12 h
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

export const ADMIN_SESSION_SECONDS = 12 * 3600;

const keyFor = (token: string) => `adm:s:${createHash('sha256').update(token).digest('hex')}`;

export class AdminSessions {
  constructor(
    private readonly redis: Redis,
    private readonly now: () => number,
  ) {}

  async create(adminId: string): Promise<{ token: string; expiresAt: number }> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(keyFor(token), adminId, 'EX', ADMIN_SESSION_SECONDS);
    return { token, expiresAt: this.now() + ADMIN_SESSION_SECONDS * 1000 };
  }

  /** The admin id, or null for an unknown or ended session. */
  async adminFor(token: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return this.redis.get(keyFor(token));
  }

  async end(token: string): Promise<void> {
    await this.redis.del(keyFor(token));
  }
}
