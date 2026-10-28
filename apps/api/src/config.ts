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
  /** HMAC key for the sign-in codes kept in Redis (32+ characters). */
  OTP_SECRET: z.string().min(32).optional(),
  OTP_SENDS_PER_IP_PER_HOUR: z.coerce.number().int().min(1).default(20),
  /** SMS (TRD §3): Termii first, Africa's Talking as the fallback. In production, phone sign-in is on only when one is set. */
  TERMII_API_KEY: z.string().min(1).optional(),
  TERMII_SENDER_ID: z.string().min(1).max(11).default('WhoSabi'),
  AT_USERNAME: z.string().min(1).optional(),
  AT_API_KEY: z.string().min(1).optional(),
  AT_SENDER_ID: z.string().min(1).max(11).optional(),
  /** The Android app's 11-character SMS Retriever hash, so the app reads the code by itself. */
  SMS_RETRIEVER_APP_HASH: z
    .string()
    .regex(/^[A-Za-z0-9+/]{11}$/)
    .optional(),
  /** Cloudflare Turnstile secret for OTP sends (required in production when phone sign-in is on). */
  TURNSTILE_SECRET: z.string().min(1).optional(),
  /** OAuth client ids (Android, iOS, web) whose Google ID tokens we accept; empty turns Google sign-in off. */
  GOOGLE_CLIENT_IDS: z.string().default(''),
  /** Bundle and service ids whose Apple ID tokens we accept; empty turns Apple sign-in off. */
  APPLE_AUDIENCES: z.string().default(''),
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
  /** Phone codes: on outside production (codes go to the log), and in production once an SMS provider is set. */
  phoneSignIn: boolean;
  otpSecret: string;
  otpSendsPerIpPerHour: number;
  sms: {
    termii?: { apiKey: string; senderId: string };
    africasTalking?: { username: string; apiKey: string; senderId?: string };
  };
  smsRetrieverAppHash?: string;
  turnstileSecret?: string;
  googleClientIds: string[];
  appleAudiences: string[];
}

// Stable outside production so analytics ids don't change on every restart.
const DEV_ANALYTICS_KEY = 'dev-only-analytics-key-not-for-production-use';
const DEV_OTP_SECRET = 'dev-only-otp-secret-not-for-production-use';

const list = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = Env.parse(env);
  const smsProvider = Boolean(e.TERMII_API_KEY || (e.AT_USERNAME && e.AT_API_KEY));
  if (e.NODE_ENV === 'production') {
    const required = ['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'ANALYTICS_KEY'];
    // Phone sign-in stays off until an SMS provider is set; then its secrets are needed too.
    if (smsProvider) required.push('OTP_SECRET', 'TURNSTILE_SECRET');
    const missing = required.filter((k) => !env[k]);
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
    corsOrigins: list(e.CORS_ORIGINS),
    cookieSecure: e.COOKIE_SECURE === 'true',
    defaultRttMs: e.DEFAULT_RTT_MS,
    guestSignupsPerIpPerHour: e.GUEST_SIGNUPS_PER_IP_PER_HOUR,
    publicWebUrl: e.PUBLIC_WEB_URL.replace(/\/+$/, ''),
    phoneSignIn: e.NODE_ENV !== 'production' || smsProvider,
    otpSecret: e.OTP_SECRET ?? DEV_OTP_SECRET,
    otpSendsPerIpPerHour: e.OTP_SENDS_PER_IP_PER_HOUR,
    sms: {
      termii: e.TERMII_API_KEY ? { apiKey: e.TERMII_API_KEY, senderId: e.TERMII_SENDER_ID } : undefined,
      africasTalking:
        e.AT_USERNAME && e.AT_API_KEY
          ? { username: e.AT_USERNAME, apiKey: e.AT_API_KEY, senderId: e.AT_SENDER_ID }
          : undefined,
    },
    smsRetrieverAppHash: e.SMS_RETRIEVER_APP_HASH,
    turnstileSecret: e.TURNSTILE_SECRET,
    googleClientIds: list(e.GOOGLE_CLIENT_IDS),
    appleAudiences: list(e.APPLE_AUDIENCES),
  };
}
