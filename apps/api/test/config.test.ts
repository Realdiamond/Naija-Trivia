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

  it('still refuses production without its signing keys', () => {
    expect(() => loadConfig({ ...production, JWT_PRIVATE_KEY: '' })).toThrow('JWT_PRIVATE_KEY');
  });
});
