/**
 * Sign-in codes, by text message (TRD FR-AUTH-2, doc 10 §1) and by email (build plan step 2.10).
 * A code exists only in Redis, as an HMAC, and works once. With {p} the channel's prefix (otp for
 * phones, eotp for email) and {to} the number or address:
 *   {p}:{request_id}              hash {to, code_hmac, attempts, platform, provider, expires_at}
 *   {p}:active:{to}               the newest request_id: sending a new code retires the old one
 *   {p}:cool:{to}                 when the last code went out: 30 s between sends to one address
 * Times are checked against the app's clock (like answer timing); Redis expiry only cleans up.
 *   {p}:n:{to}:{wat date}         codes sent to the address today (max 5)
 *   {p}:d:{device}:{wat date}     codes sent from the device today (max 10)
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import { watDate } from '@whosabi/game-rules';
import { ErrorCode, type Platform } from '@whosabi/shared-types';
import { ApiError } from '../errors';
import type { EmailSender, OutgoingEmail } from './email';
import type { CaptchaVerifier } from './providers';
import type { SmsSender } from './sms';

export const OTP_TTL_SECONDS = 300;
/** Email can take a while to arrive (step 2.10). */
export const EMAIL_CODE_TTL_SECONDS = 600;
export const RESEND_AFTER_SECONDS = 30;
export const MAX_SENDS_PER_NUMBER = 5;
export const MAX_SENDS_PER_DEVICE = 10;
export const MAX_ATTEMPTS = 5;
/** Doc 10 §1: a CAPTCHA after 2 sends. The web needs one every time (doc 09 §2.1). */
export const FREE_APP_SENDS = 2;
const COUNTER_TTL_SECONDS = 26 * 3600;

/** How codes reach people: a text message or an email. */
export interface CodeChannel {
  /** Redis key prefix and request id prefix: `otp` for phones, `eotp` for email. */
  prefix: string;
  ttlSeconds: number;
  /** Sends the code and returns the provider that took it; throws if none did. */
  deliver(to: string, code: string, platform: Platform): Promise<string>;
}

export interface OtpOptions {
  redis: Redis;
  channel: CodeChannel;
  captcha: CaptchaVerifier;
  secret: string;
  now: () => number;
}

export interface SendInput {
  /** An E.164 number or a lower-cased email address. */
  to: string;
  platform: Platform;
  captchaToken?: string;
  ip: string;
  deviceId?: string | null;
}

export interface VerifiedCode {
  to: string;
  platform: Platform;
  provider: string;
}

/** A failure carries the provider, for the OTP health events (doc 13). */
export type VerifyResult =
  { ok: true; code: VerifiedCode } | { ok: false; error: ApiError; provider: string };

export class OtpService {
  constructor(private readonly o: OtpOptions) {}

  async send(input: SendInput): Promise<{ requestId: string; provider: string }> {
    const { redis, channel } = this.o;
    const { to, platform } = input;
    const p = channel.prefix;
    const date = watDate(this.o.now());
    const numberKey = `${p}:n:${to}:${date}`;
    const deviceKey = input.deviceId ? `${p}:d:${input.deviceId}:${date}` : null;

    const sentToNumber = Number((await redis.get(numberKey)) ?? 0);
    const sentFromDevice = deviceKey ? Number((await redis.get(deviceKey)) ?? 0) : 0;
    if (sentToNumber >= MAX_SENDS_PER_NUMBER || sentFromDevice >= MAX_SENDS_PER_DEVICE) {
      throw new ApiError(
        429,
        ErrorCode.otpLimitReached,
        'Too many codes today',
        'Try again tomorrow, or sign in with Google.',
      );
    }

    if (platform === 'web' || sentToNumber >= FREE_APP_SENDS) {
      if (!input.captchaToken) {
        throw new ApiError(
          403,
          ErrorCode.captchaRequired,
          'Please confirm you are human',
          'Send a Turnstile token.',
        );
      }
      if (!(await this.o.captcha.verify(input.captchaToken, input.ip))) {
        throw new ApiError(403, ErrorCode.captchaFailed, 'The human check did not pass', 'Try again.');
      }
    }

    const now = this.o.now();
    const coolKey = `${p}:cool:${to}`;
    const lastSent = Number((await redis.get(coolKey)) ?? 0);
    const waitMs = lastSent + RESEND_AFTER_SECONDS * 1000 - now;
    if (waitMs > 0) {
      throw new ApiError(
        429,
        ErrorCode.rateLimited,
        'Wait a moment before asking again',
        undefined,
        Math.ceil(waitMs / 1000),
      );
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const requestId = `${p}_${randomBytes(16).toString('base64url')}`;
    const ttl = channel.ttlSeconds;
    const counters = redis.multi().incr(numberKey).expire(numberKey, COUNTER_TTL_SECONDS);
    if (deviceKey) counters.incr(deviceKey).expire(deviceKey, COUNTER_TTL_SECONDS);
    await counters
      .hset(`${p}:${requestId}`, {
        to,
        code_hmac: this.hmac(requestId, code),
        attempts: 0,
        platform,
        expires_at: now + ttl * 1000,
      })
      .expire(`${p}:${requestId}`, ttl)
      .set(`${p}:active:${to}`, requestId, 'EX', ttl)
      .set(coolKey, String(now), 'EX', RESEND_AFTER_SECONDS)
      .exec();

    let provider: string;
    try {
      provider = await channel.deliver(to, code, platform);
    } catch {
      // Nothing was sent, so nothing counts against the player.
      const undo = redis.multi().decr(numberKey).del(`${p}:${requestId}`, coolKey);
      if (deviceKey) undo.decr(deviceKey);
      await undo.exec();
      throw new ApiError(
        503,
        ErrorCode.providerUnavailable,
        'We could not send the code',
        'Try again shortly.',
      );
    }
    await redis.hset(`${p}:${requestId}`, 'provider', provider);
    return { requestId, provider };
  }

  async verify(requestId: string, code: string): Promise<VerifyResult> {
    const { redis } = this.o;
    const p = this.o.channel.prefix;
    const key = `${p}:${requestId}`;
    const record = await redis.hgetall(key);
    const provider = record.provider ?? 'unknown';
    const fail = (error: ApiError): VerifyResult => ({ ok: false, error, provider });
    if (!record.to || Number(record.expires_at) <= this.o.now()) return fail(expired());
    if ((await redis.get(`${p}:active:${record.to}`)) !== requestId) {
      await redis.del(key);
      return fail(expired('A newer code was sent. Use the latest one.'));
    }
    if (Number(record.attempts) >= MAX_ATTEMPTS) return fail(tooManyAttempts());

    const expected = Buffer.from(record.code_hmac ?? '', 'hex');
    const given = Buffer.from(this.hmac(requestId, code), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      const attempts = await redis.hincrby(key, 'attempts', 1);
      if (attempts >= MAX_ATTEMPTS) {
        await redis.del(key, `${p}:active:${record.to}`);
        return fail(tooManyAttempts());
      }
      const left = MAX_ATTEMPTS - attempts;
      return fail(
        new ApiError(
          400,
          ErrorCode.otpInvalid,
          'That code is not right',
          `${left} ${left === 1 ? 'try' : 'tries'} left.`,
        ),
      );
    }
    // Single use: of two requests racing with the right code, only one deletes the key.
    if ((await redis.del(key)) !== 1) return fail(expired());
    await redis.del(`${p}:active:${record.to}`);
    return { ok: true, code: { to: record.to, platform: record.platform as Platform, provider } };
  }

  private hmac(requestId: string, code: string): string {
    return createHmac('sha256', this.o.secret).update(`${requestId}:${code}`).digest('hex');
  }
}

const expired = (detail = 'Request a new code.') =>
  new ApiError(400, ErrorCode.otpExpired, 'This code has expired', detail);
const tooManyAttempts = () =>
  new ApiError(400, ErrorCode.otpTooManyAttempts, 'Too many wrong tries', 'Request a new code.');

export interface PhoneTextOptions {
  /** Host for the WebOTP line, e.g. whosabi.ng. */
  webOtpDomain: string;
  smsRetrieverAppHash?: string;
}

export function phoneChannel(sms: SmsSender, options: PhoneTextOptions): CodeChannel {
  return {
    prefix: 'otp',
    ttlSeconds: OTP_TTL_SECONDS,
    deliver: (to, code, platform) => sms.send(to, phoneCodeText(code, platform, options)),
  };
}

/**
 * The text per platform (TRD FR-AUTH-2): Android ends with the SMS Retriever hash so the app
 * reads the code itself; the web adds the WebOTP line Chrome on Android fills from; iOS and
 * other browsers offer the code from the message through autocomplete="one-time-code".
 */
export function phoneCodeText(code: string, platform: Platform, options: PhoneTextOptions): string {
  const base = `Your Who Sabi? code is ${code}. It expires in 5 minutes. Don't share it with anyone.`;
  if (platform === 'android' && options.smsRetrieverAppHash) return `${base}\n${options.smsRetrieverAppHash}`;
  if (platform === 'web') return `${base}\n\n@${options.webOtpDomain} #${code}`;
  return base;
}

export function emailChannel(email: EmailSender): CodeChannel {
  return {
    prefix: 'eotp',
    ttlSeconds: EMAIL_CODE_TTL_SECONDS,
    deliver: (to, code) => email.send(codeEmail(to, code)),
  };
}

/** The code is in the subject too, so it shows in the phone's notification. */
export function codeEmail(to: string, code: string): OutgoingEmail {
  const minutes = EMAIL_CODE_TTL_SECONDS / 60;
  return {
    to,
    subject: `${code} is your Who Sabi? code`,
    text: [
      `Your Who Sabi? code is ${code}.`,
      '',
      `Type it in the game to sign in. It expires in ${minutes} minutes. Don't share it with anyone.`,
      '',
      "If you didn't ask for this code, you can ignore this email.",
    ].join('\n'),
    html: `<!doctype html>
<html><body style="margin:0;padding:24px;background:#FFFDF7;font-family:Arial,Helvetica,sans-serif;color:#14231B">
<table role="presentation" width="100%" style="max-width:480px;margin:0 auto">
<tr><td style="font-size:22px;font-weight:bold;color:#008751;padding-bottom:16px">Who Sabi?</td></tr>
<tr><td style="font-size:16px;padding-bottom:12px">Your sign-in code is</td></tr>
<tr><td style="font-size:36px;font-weight:bold;letter-spacing:8px;padding:16px;background:#E3F3EA;border-radius:12px;text-align:center">${code}</td></tr>
<tr><td style="font-size:14px;padding-top:16px">Type it in the game to sign in. It expires in ${minutes} minutes. Don't share it with anyone.</td></tr>
<tr><td style="font-size:12px;color:#5A6660;padding-top:16px">If you didn't ask for this code, you can ignore this email.</td></tr>
</table>
</body></html>`,
  };
}
