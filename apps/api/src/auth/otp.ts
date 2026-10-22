/**
 * Phone sign-in codes (TRD FR-AUTH-2, doc 10 §1). A code exists only in Redis, as an HMAC,
 * for 5 minutes, and works once:
 *   otp:{request_id}              hash {phone, code_hmac, attempts, platform, provider, expires_at}
 *   otp:active:{phone}            the newest request_id: sending a new code retires the old one
 *   otp:cool:{phone}              when the last code went out: 30 s between sends to a number
 * Times are checked against the app's clock (like answer timing); Redis expiry only cleans up.
 *   otp:n:{phone}:{wat date}      codes sent to the number today (max 5)
 *   otp:d:{device}:{wat date}     codes sent from the device today (max 10)
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import { watDate } from '@whosabi/game-rules';
import { ErrorCode, type Platform } from '@whosabi/shared-types';
import { ApiError } from '../errors';
import type { CaptchaVerifier } from './providers';
import type { SmsSender } from './sms';

export const OTP_TTL_SECONDS = 300;
export const RESEND_AFTER_SECONDS = 30;
export const MAX_SENDS_PER_NUMBER = 5;
export const MAX_SENDS_PER_DEVICE = 10;
export const MAX_ATTEMPTS = 5;
/** Doc 10 §1: a CAPTCHA after 2 sends. The web needs one every time (doc 09 §2.1). */
export const FREE_APP_SENDS = 2;
const COUNTER_TTL_SECONDS = 26 * 3600;

export interface OtpOptions {
  redis: Redis;
  sms: SmsSender;
  captcha: CaptchaVerifier;
  secret: string;
  now: () => number;
  /** Host for the WebOTP line, e.g. whosabi.ng. */
  webOtpDomain: string;
  smsRetrieverAppHash?: string;
}

export interface SendInput {
  phone: string;
  platform: Platform;
  captchaToken?: string;
  ip: string;
  deviceId?: string | null;
}

export interface VerifiedCode {
  phone: string;
  platform: Platform;
  provider: string;
}

/** A failure carries the SMS provider, for the OTP health events (doc 13). */
export type VerifyResult =
  { ok: true; code: VerifiedCode } | { ok: false; error: ApiError; provider: string };

export class OtpService {
  constructor(private readonly o: OtpOptions) {}

  async send(input: SendInput): Promise<{ requestId: string; provider: string }> {
    const { redis } = this.o;
    const { phone, platform } = input;
    const date = watDate(this.o.now());
    const numberKey = `otp:n:${phone}:${date}`;
    const deviceKey = input.deviceId ? `otp:d:${input.deviceId}:${date}` : null;

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
    const coolKey = `otp:cool:${phone}`;
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
    const requestId = `otp_${randomBytes(16).toString('base64url')}`;
    const counters = redis.multi().incr(numberKey).expire(numberKey, COUNTER_TTL_SECONDS);
    if (deviceKey) counters.incr(deviceKey).expire(deviceKey, COUNTER_TTL_SECONDS);
    await counters
      .hset(`otp:${requestId}`, {
        phone,
        code_hmac: this.hmac(requestId, code),
        attempts: 0,
        platform,
        expires_at: now + OTP_TTL_SECONDS * 1000,
      })
      .expire(`otp:${requestId}`, OTP_TTL_SECONDS)
      .set(`otp:active:${phone}`, requestId, 'EX', OTP_TTL_SECONDS)
      .set(coolKey, String(now), 'EX', RESEND_AFTER_SECONDS)
      .exec();

    let provider: string;
    try {
      provider = await this.o.sms.send(phone, this.message(code, platform));
    } catch {
      // Nothing was sent, so nothing counts against the player.
      const undo = redis.multi().decr(numberKey).del(`otp:${requestId}`, coolKey);
      if (deviceKey) undo.decr(deviceKey);
      await undo.exec();
      throw new ApiError(
        503,
        ErrorCode.providerUnavailable,
        'We could not send the code',
        'Try again shortly.',
      );
    }
    await redis.hset(`otp:${requestId}`, 'provider', provider);
    return { requestId, provider };
  }

  async verify(requestId: string, code: string): Promise<VerifyResult> {
    const { redis } = this.o;
    const key = `otp:${requestId}`;
    const record = await redis.hgetall(key);
    const provider = record.provider ?? 'unknown';
    const fail = (error: ApiError): VerifyResult => ({ ok: false, error, provider });
    if (!record.phone || Number(record.expires_at) <= this.o.now()) return fail(expired());
    if ((await redis.get(`otp:active:${record.phone}`)) !== requestId) {
      await redis.del(key);
      return fail(expired('A newer code was sent. Use the latest one.'));
    }
    if (Number(record.attempts) >= MAX_ATTEMPTS) return fail(tooManyAttempts());

    const expected = Buffer.from(record.code_hmac ?? '', 'hex');
    const given = Buffer.from(this.hmac(requestId, code), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      const attempts = await redis.hincrby(key, 'attempts', 1);
      if (attempts >= MAX_ATTEMPTS) {
        await redis.del(key, `otp:active:${record.phone}`);
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
    await redis.del(`otp:active:${record.phone}`);
    return { ok: true, code: { phone: record.phone, platform: record.platform as Platform, provider } };
  }

  /**
   * The text per platform (TRD FR-AUTH-2): Android ends with the SMS Retriever hash so the app
   * reads the code itself; the web adds the WebOTP line Chrome on Android fills from; iOS and
   * other browsers offer the code from the message through autocomplete="one-time-code".
   */
  message(code: string, platform: Platform): string {
    const base = `Your Who Sabi? code is ${code}. It expires in 5 minutes. Don't share it with anyone.`;
    if (platform === 'android' && this.o.smsRetrieverAppHash) return `${base}\n${this.o.smsRetrieverAppHash}`;
    if (platform === 'web') return `${base}\n\n@${this.o.webOtpDomain} #${code}`;
    return base;
  }

  private hmac(requestId: string, code: string): string {
    return createHmac('sha256', this.o.secret).update(`${requestId}:${code}`).digest('hex');
  }
}

const expired = (detail = 'Request a new code.') =>
  new ApiError(400, ErrorCode.otpExpired, 'This code has expired', detail);
const tooManyAttempts = () =>
  new ApiError(400, ErrorCode.otpTooManyAttempts, 'Too many wrong tries', 'Request a new code.');
