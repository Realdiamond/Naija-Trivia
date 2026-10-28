import { z } from 'zod';
import { ServiceAccount } from './push/transport';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /**
   * Check the Redis server's TLS certificate (rediss:// URLs). Heroku Key-Value Store uses
   * self-signed certificates, so it runs with false. Postgres reads PGSSLMODE the same way.
   */
  REDIS_TLS_VERIFY: z.enum(['true', 'false']).default('true'),
  /** The web app's export (apps/app/web-build) to serve from this origin, e.g. on Heroku. */
  WEB_APP_DIR: z.string().min(1).optional(),
  /** Serve the event intake (POST /v1/events) in this process instead of the ingest service. */
  EVENTS_IN_API: z.enum(['true', 'false']).default('false'),
  /** ES256 keys as PEM (PKCS#8 private, SPKI public). Generated per process outside production. */
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  /** HMAC key for pseudonymous analytics ids (doc 18 §15). */
  ANALYTICS_KEY: z.string().min(32).optional(),
  /** Days the worker keeps raw analytics events in Postgres; daily counts are kept for good. */
  ANALYTICS_RETENTION_DAYS: z.coerce.number().int().min(7).max(400).default(60),
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
  /** Resend (step 2.10): email sign-in codes are on in production once this is set. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** The sender of sign-in codes, on a domain verified in Resend. */
  EMAIL_FROM: z.string().min(3).default('Who Sabi? <codes@whosabi.ng>'),
  /** Cloudflare Turnstile secret for code sends (required in production when phone or email sign-in is on). */
  TURNSTILE_SECRET: z.string().min(1).optional(),
  /** OAuth client ids (Android, iOS, web) whose Google ID tokens we accept; empty turns Google sign-in off. */
  GOOGLE_CLIENT_IDS: z.string().default(''),
  /** Bundle and service ids whose Apple ID tokens we accept; empty turns Apple sign-in off. */
  APPLE_AUDIENCES: z.string().default(''),
  /** The admin console's Google OAuth client id(s); empty turns staff Google sign-in off. */
  ADMIN_GOOGLE_CLIENT_IDS: z.string().default(''),
  /** When set, staff must sign in with a Google Workspace account on this domain (doc 18 §16). */
  ADMIN_GOOGLE_DOMAIN: z.string().min(3).optional(),
  /**
   * SHA-256 fingerprints of the Android app's signing certificates (Play Console, App signing),
   * comma-separated. With them, links to the web app open the installed app (App Links).
   */
  ANDROID_CERT_SHA256: z
    .string()
    .default('')
    .refine(
      (v) => v.split(',').every((f) => !f.trim() || /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(f.trim())),
      'Each fingerprint is 32 pairs of hex digits joined by colons',
    ),
  /**
   * The Firebase service account key (Project settings → Service accounts → Generate new private
   * key), the whole JSON file as one setting. Unset, pushes are written to the worker's log.
   */
  FIREBASE_SERVICE_ACCOUNT: z.string().min(1).optional(),
  /** The Apple developer Team ID, for iOS Universal Links; unset until there is an iOS app. */
  APPLE_TEAM_ID: z
    .string()
    .regex(/^[A-Z0-9]{10}$/)
    .optional(),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  redisUrl: string;
  redisTlsVerify: boolean;
  webAppDir?: string;
  eventsInApi: boolean;
  jwtPrivateKeyPem?: string;
  jwtPublicKeyPem?: string;
  analyticsKey: string;
  analyticsRetentionDays: number;
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
  /** Email codes: on outside production (codes go to the log), and in production once Resend is set. */
  emailSignIn: boolean;
  resend?: { apiKey: string; from: string };
  turnstileSecret?: string;
  googleClientIds: string[];
  appleAudiences: string[];
  adminGoogleClientIds: string[];
  adminGoogleDomain?: string;
  androidCertSha256: string[];
  appleTeamId?: string;
  firebaseServiceAccount?: ServiceAccount;
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
    // Phone and email sign-in stay off until a provider is set; then their secrets are needed too.
    if (smsProvider || e.RESEND_API_KEY) required.push('OTP_SECRET', 'TURNSTILE_SECRET');
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
    redisTlsVerify: e.REDIS_TLS_VERIFY === 'true',
    webAppDir: e.WEB_APP_DIR,
    eventsInApi: e.EVENTS_IN_API === 'true',
    // Hosts that take one-line settings may have the PEM's line breaks as "\n".
    jwtPrivateKeyPem: e.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    jwtPublicKeyPem: e.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n'),
    analyticsKey: e.ANALYTICS_KEY ?? DEV_ANALYTICS_KEY,
    analyticsRetentionDays: e.ANALYTICS_RETENTION_DAYS,
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
    emailSignIn: e.NODE_ENV !== 'production' || Boolean(e.RESEND_API_KEY),
    resend: e.RESEND_API_KEY ? { apiKey: e.RESEND_API_KEY, from: e.EMAIL_FROM } : undefined,
    turnstileSecret: e.TURNSTILE_SECRET,
    googleClientIds: list(e.GOOGLE_CLIENT_IDS),
    appleAudiences: list(e.APPLE_AUDIENCES),
    adminGoogleClientIds: list(e.ADMIN_GOOGLE_CLIENT_IDS),
    adminGoogleDomain: e.ADMIN_GOOGLE_DOMAIN,
    androidCertSha256: list(e.ANDROID_CERT_SHA256).map((f) => f.toUpperCase()),
    appleTeamId: e.APPLE_TEAM_ID,
    firebaseServiceAccount: e.FIREBASE_SERVICE_ACCOUNT
      ? serviceAccount(e.FIREBASE_SERVICE_ACCOUNT)
      : undefined,
  };
}

/** A readable error for a pasted key that isn't the Firebase JSON file; never echoes the key. */
function serviceAccount(json: string): ServiceAccount {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not JSON: paste the whole key file from Firebase');
  }
  const parsed = ServiceAccount.safeParse(value);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`FIREBASE_SERVICE_ACCOUNT is missing or has bad fields: ${fields}`);
  }
  return parsed.data;
}
