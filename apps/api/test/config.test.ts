import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createAuthProviders } from '../src/auth/providers';
import { loadConfig } from '../src/config';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://db.example/whosabi',
  REDIS_URL: 'redis://cache.example:6379',
  JWT_PRIVATE_KEY: 'private-key-pem',
  JWT_PUBLIC_KEY: 'public-key-pem',
  ANALYTICS_KEY: 'a'.repeat(32),
};
const silent = { info() {}, warn() {} } as unknown as FastifyBaseLogger;

describe('phone sign-in settings', () => {
  it('starts production without an SMS provider, with phone sign-in off', () => {
    const config = loadConfig(production);
    expect(config.phoneSignIn).toBe(false);
    expect(createAuthProviders(config, silent, Date.now).sms).toBeNull();
  });

  it('turns phone sign-in on with an SMS provider, and then needs its secrets', () => {
    expect(() => loadConfig({ ...production, TERMII_API_KEY: 'termii-key' })).toThrow(
      'Missing required production settings: OTP_SECRET, TURNSTILE_SECRET',
    );
    const config = loadConfig({
      ...production,
      TERMII_API_KEY: 'termii-key',
      OTP_SECRET: 'o'.repeat(32),
      TURNSTILE_SECRET: 'turnstile-secret',
    });
    expect(config.phoneSignIn).toBe(true);
    expect(createAuthProviders(config, silent, Date.now).sms).not.toBeNull();
  });

  it('keeps phone sign-in on outside production, where codes go to the log', () => {
    const config = loadConfig({ DATABASE_URL: production.DATABASE_URL, REDIS_URL: production.REDIS_URL });
    expect(config.phoneSignIn).toBe(true);
    expect(createAuthProviders(config, silent, Date.now).sms).not.toBeNull();
  });

  it('turns email sign-in on in production only with a Resend key, which needs the same secrets', () => {
    const off = loadConfig(production);
    expect(off.emailSignIn).toBe(false);
    expect(createAuthProviders(off, silent, Date.now).email).toBeNull();
    expect(() => loadConfig({ ...production, RESEND_API_KEY: 're_key' })).toThrow(
      'Missing required production settings: OTP_SECRET, TURNSTILE_SECRET',
    );
    const on = loadConfig({
      ...production,
      RESEND_API_KEY: 're_key',
      OTP_SECRET: 'o'.repeat(32),
      TURNSTILE_SECRET: 'turnstile-secret',
    });
    expect(on.resend).toEqual({ apiKey: 're_key', from: 'Who Sabi? <codes@whosabi.ng>' });
    expect(createAuthProviders(on, silent, Date.now).email).not.toBeNull();
    // Outside production, codes go to the log.
    const dev = loadConfig({ DATABASE_URL: production.DATABASE_URL, REDIS_URL: production.REDIS_URL });
    expect(createAuthProviders(dev, silent, Date.now).email).not.toBeNull();
  });

  it('still refuses production without its signing keys', () => {
    expect(() => loadConfig({ ...production, JWT_PRIVATE_KEY: '' })).toThrow('JWT_PRIVATE_KEY');
  });
});

describe('push settings', () => {
  const key = {
    type: 'service_account',
    project_id: 'who-sabi',
    private_key_id: 'abc',
    private_key: '-----BEGIN PRIVATE KEY-----\nsecret-key-material\n-----END PRIVATE KEY-----\n',
    client_email: 'firebase-adminsdk@who-sabi.iam.gserviceaccount.com',
  };

  it('starts without Firebase, and reads the key file pasted whole', () => {
    expect(loadConfig(production).firebaseServiceAccount).toBeUndefined();
    expect(
      loadConfig({ ...production, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(key, null, 2) })
        .firebaseServiceAccount,
    ).toEqual({
      project_id: 'who-sabi',
      client_email: key.client_email,
      private_key: key.private_key,
      token_uri: 'https://oauth2.googleapis.com/token',
    });
  });

  it('says what is wrong with a bad key, without repeating it', () => {
    const attempt = (value: string) => () => loadConfig({ ...production, FIREBASE_SERVICE_ACCOUNT: value });
    expect(attempt('not json secret-key-material')).toThrow(/is not JSON/);
    expect(attempt('not json secret-key-material')).not.toThrow(/secret-key-material/);
    expect(attempt(JSON.stringify({ ...key, client_email: undefined }))).toThrow(/client_email/);
    expect(attempt(JSON.stringify({ ...key, client_email: undefined }))).not.toThrow(/secret-key-material/);
  });
});
