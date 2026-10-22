/**
 * The outside services sign-in depends on, behind small interfaces so tests and local
 * development run without accounts or network: SMS, Cloudflare Turnstile, and Google and
 * Apple ID-token checks (TRD FR-AUTH-2, FR-AUTH-3, doc 10 §1).
 */
import type { FastifyBaseLogger } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Config } from '../config';
import { AfricasTalkingSms, DevSms, FailoverSms, TermiiSms, type SmsSender } from './sms';

export interface CaptchaVerifier {
  verify(token: string, ip: string): Promise<boolean>;
}

export interface VerifiedIdToken {
  subject: string;
  email?: string;
  nonce?: string;
}

export interface IdTokenVerifier {
  /** Throws if the token is not valid for us. */
  verify(token: string): Promise<VerifiedIdToken>;
}

export interface AuthProviders {
  sms: SmsSender;
  captcha: CaptchaVerifier;
  /** Null when the sign-in method is not configured. */
  google: IdTokenVerifier | null;
  apple: IdTokenVerifier | null;
}

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
export const APPLE_ISSUERS = ['https://appleid.apple.com'];

export function idTokenVerifier(options: {
  issuers: string[];
  audiences: string[];
  keys: JWTVerifyGetKey;
  now: () => number;
}): IdTokenVerifier {
  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, options.keys, {
        issuer: options.issuers,
        audience: options.audiences,
        algorithms: ['RS256', 'ES256'],
        currentDate: new Date(options.now()),
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0)
        throw new Error('token has no subject');
      return {
        subject: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
      };
    },
  };
}

/** Cloudflare Turnstile server-side check. A network failure counts as a failed check. */
export class TurnstileVerifier implements CaptchaVerifier {
  constructor(
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(token: string, ip: string): Promise<boolean> {
    try {
      const res = await this.fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: this.secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok && ((await res.json()) as { success?: boolean }).success === true;
    } catch {
      return false;
    }
  }
}

export function createAuthProviders(
  config: Config,
  log: FastifyBaseLogger,
  now: () => number,
): AuthProviders {
  const senders: SmsSender[] = [];
  if (config.sms.termii) senders.push(new TermiiSms(config.sms.termii));
  if (config.sms.africasTalking) senders.push(new AfricasTalkingSms(config.sms.africasTalking));
  // loadConfig refuses to start production without a provider, so DevSms never runs there.
  const sms = senders.length > 0 ? new FailoverSms(senders, log) : new DevSms(log);

  const captcha: CaptchaVerifier = config.turnstileSecret
    ? new TurnstileVerifier(config.turnstileSecret)
    : { verify: async (token) => token.length > 0 };

  return {
    sms,
    captcha,
    google:
      config.googleClientIds.length > 0
        ? idTokenVerifier({
            issuers: GOOGLE_ISSUERS,
            audiences: config.googleClientIds,
            keys: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
            now,
          })
        : null,
    apple:
      config.appleAudiences.length > 0
        ? idTokenVerifier({
            issuers: APPLE_ISSUERS,
            audiences: config.appleAudiences,
            keys: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')),
            now,
          })
        : null,
  };
}
