/**
 * `Idempotency-Key` for mutations without a natural key (doc 09 §1): the first request's
 * result is kept for 24 h and replayed to retries with the same key. A retry that arrives
 * while the first is still running gets 409 and tries again shortly.
 *   idem:{user}:{operation}:{key}   {"pending":true} while running, then {status, body}
 */
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { ErrorCode } from '@whosabi/shared-types';
import { ApiError, conflict } from './errors';

const RESULT_TTL_SECONDS = 24 * 3600;
/** Long enough for any request to finish; a crashed one frees the key after this. */
const PENDING_TTL_SECONDS = 60;
const KEY_FORMAT = /^[A-Za-z0-9_-]{8,64}$/;

export interface StoredResult<T> {
  status: number;
  body: T;
}

/** The request's Idempotency-Key, if any. A malformed key is a 400 rather than silently ignored. */
export function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers['idempotency-key'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !KEY_FORMAT.test(value)) {
    throw new ApiError(
      400,
      ErrorCode.validation,
      'The request is not valid',
      'Idempotency-Key must be 8–64 letters, digits, "-" or "_" (a UUID works).',
    );
  }
  return value;
}

export async function once<T>(
  redis: Redis,
  scope: { userId: string; operation: string },
  key: string | undefined,
  run: () => Promise<StoredResult<T>>,
): Promise<StoredResult<T>> {
  if (!key) return run();
  const redisKey = `idem:${scope.userId}:${scope.operation}:${key}`;
  const claimed = await redis.set(redisKey, '{"pending":true}', 'EX', PENDING_TTL_SECONDS, 'NX');
  if (claimed !== 'OK') {
    const stored = await redis.get(redisKey);
    const parsed = stored ? (JSON.parse(stored) as StoredResult<T> | { pending: true }) : null;
    if (!parsed || 'pending' in parsed) {
      throw conflict(
        ErrorCode.requestInProgress,
        'This request is still being handled',
        'Try again shortly.',
      );
    }
    return parsed;
  }
  try {
    const result = await run();
    await redis.set(redisKey, JSON.stringify(result), 'EX', RESULT_TTL_SECONDS);
    return result;
  } catch (error) {
    // A failed attempt doesn't count: the client may retry with the same key.
    await redis.del(redisKey).catch(() => undefined);
    throw error;
  }
}
