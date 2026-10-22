import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** ES256 keys as PEM (PKCS#8 private, SPKI public). Generated per process outside production. */
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  /** HMAC key for pseudonymous analytics ids (doc 18 §15). */
  ANALYTICS_KEY: z.string().min(32).optional(),
  CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:19006'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  /** Round-trip estimate used for answer timing until per-session RTT sampling lands. */
  DEFAULT_RTT_MS: z.coerce.number().int().min(0).max(5000).default(400),
  GUEST_SIGNUPS_PER_IP_PER_HOUR: z.coerce.number().int().min(1).default(30),
  /** The web app; duel invite links are {PUBLIC_WEB_URL}/d/{token} (doc 09 §5). */
  PUBLIC_WEB_URL: z.url().default('https://whosabi.ng'),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  redisUrl: string;
  jwtPrivateKeyPem?: string;
  jwtPublicKeyPem?: string;
  analyticsKey: string;
  corsOrigins: string[];
  cookieSecure: boolean;
  defaultRttMs: number;
  guestSignupsPerIpPerHour: number;
  publicWebUrl: string;
}

// Stable outside production so analytics ids don't change on every restart.
const DEV_ANALYTICS_KEY = 'dev-only-analytics-key-not-for-production-use';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = Env.parse(env);
  if (e.NODE_ENV === 'production') {
    const missing = ['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'ANALYTICS_KEY'].filter((k) => !env[k]);
    if (missing.length) throw new Error(`Missing required production settings: ${missing.join(', ')}`);
  }
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    jwtPrivateKeyPem: e.JWT_PRIVATE_KEY,
    jwtPublicKeyPem: e.JWT_PUBLIC_KEY,
    analyticsKey: e.ANALYTICS_KEY ?? DEV_ANALYTICS_KEY,
    corsOrigins: e.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    cookieSecure: e.COOKIE_SECURE === 'true',
    defaultRttMs: e.DEFAULT_RTT_MS,
    guestSignupsPerIpPerHour: e.GUEST_SIGNUPS_PER_IP_PER_HOUR,
    publicWebUrl: e.PUBLIC_WEB_URL.replace(/\/+$/, ''),
  };
}
