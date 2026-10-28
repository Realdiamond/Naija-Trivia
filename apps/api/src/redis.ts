import { Redis, type RedisOptions } from 'ioredis';
import type { Config } from './config';

/** A Redis connection from the settings, with TLS for rediss:// URLs (Heroku Key-Value Store). */
export function createRedis(
  config: Pick<Config, 'redisUrl' | 'redisTlsVerify'>,
  options: RedisOptions = {},
): Redis {
  const tls = config.redisUrl.startsWith('rediss://')
    ? { tls: { rejectUnauthorized: config.redisTlsVerify } }
    : {};
  return new Redis(config.redisUrl, { ...options, ...tls });
}
