/**
 * Guardian consent for 13–17s (doc 10 §3.3, NDPA s.31, build plan step 2.8d). A 13–17 account
 * waits for a parent or guardian: they get a code by text or email and, if they agree, give it
 * to the player, who types it in. Until then the account plays like a guest (no username, no
 * friends). The record is a `consent_records` row (purpose 'guardian') saying how it was given;
 * the guardian's number or address is kept only masked and hashed.
 *
 * The codes are sign-in codes with their own prefixes (gotp for texts, geotp for email), so one
 * kind can never stand in for the other, and the same limits: 5 a day to one number or address,
 * 30 seconds between sends, 5 tries, and the human check on the web.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  ErrorCode,
  GuardianSendRequest,
  GuardianVerifyRequest,
  normalizeNigerianPhone,
  type Me,
  type OtpSendResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { maskEmail, type EmailSender, type OutgoingEmail } from '../auth/email';
import { OtpService, RESEND_AFTER_SECONDS, type CodeChannel } from '../auth/otp';
import type { SmsSender } from '../auth/sms';
import { withTransaction } from '../db';
import { ApiError, conflict, parse } from '../errors';
import { requestEventContext } from '../events';
import { currentMe } from '../profile/routes';

/** The terms a guardian agrees to; a new version when doc 10 §3.3 changes. */
export const GUARDIAN_POLICY_VERSION = '2026-10';
const CODE_TTL_SECONDS = 600;
const PHONE_PREFIX = 'gotp';
const EMAIL_PREFIX = 'geotp';
/** Which player asked for a code: only they can use it. */
const askerKey = (requestId: string) => `guardian:asker:${requestId}`;

/** Short enough for one or two text messages. */
export function guardianText(code: string): string {
  return `A child wants to play Who Sabi? (Naija trivia, 13+) and asked you to agree. If you do, give them this code: ${code}. It expires in 10 minutes. Not yours? Ignore this.`;
}

export function guardianEmail(to: string, code: string): OutgoingEmail {
  const lines = [
    'A child in your care wants to play Who Sabi?, a Naija trivia game for ages 13 and up, and asked you to agree.',
    '',
    'Players under 18 get a restricted account: family-safe questions only, no name on public leaderboards, never findable by their phone number, and no personalised ads.',
    '',
    `If you agree, give them this code: ${code}. It expires in 10 minutes.`,
    '',
    'You can withdraw your consent at any time by writing to help@whosabi.ng; we then delete the account.',
    "If you don't know what this is about, ignore this email.",
  ];
  return {
    to,
    subject: `${code}: a child wants to play Who Sabi?`,
    text: lines.join('\n'),
    html: `<!doctype html>
<html><body style="margin:0;padding:24px;background:#FFFDF7;font-family:Arial,Helvetica,sans-serif;color:#14231B">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto">
<tr><td style="font-size:22px;font-weight:bold;color:#008751;padding-bottom:16px">Who Sabi?</td></tr>
<tr><td style="font-size:16px;padding-bottom:12px">${lines[0]}</td></tr>
<tr><td style="font-size:14px;padding-bottom:12px">${lines[2]}</td></tr>
<tr><td style="font-size:16px;padding-bottom:8px">If you agree, give them this code:</td></tr>
<tr><td style="font-size:36px;font-weight:bold;letter-spacing:8px;padding:16px;background:#E3F3EA;border-radius:12px;text-align:center">${code}</td></tr>
<tr><td style="font-size:14px;padding-top:16px">It expires in 10 minutes. You can withdraw your consent at any time by writing to help@whosabi.ng; we then delete the account.</td></tr>
<tr><td style="font-size:12px;color:#5A6660;padding-top:16px">If you don't know what this is about, ignore this email.</td></tr>
</table>
</body></html>`,
  };
}

function phoneChannel(sms: SmsSender): CodeChannel {
  return {
    prefix: PHONE_PREFIX,
    ttlSeconds: CODE_TTL_SECONDS,
    deliver: (to, code) => sms.send(to, guardianText(code)),
  };
}

function emailChannel(email: EmailSender): CodeChannel {
  return {
    prefix: EMAIL_PREFIX,
    ttlSeconds: CODE_TTL_SECONDS,
    deliver: (to, code) => email.send(guardianEmail(to, code)),
  };
}

/** +2348031234567 → +234803•••••67. */
const maskPhone = (phone: string) => `${phone.slice(0, 7)}${'•'.repeat(phone.length - 9)}${phone.slice(-2)}`;

export function guardianRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { pool, redis, clock, config, events } = deps;
  const options = { redis, captcha: deps.auth.captcha, secret: config.otpSecret, now: clock.now };
  const byPhone = deps.auth.sms ? new OtpService({ ...options, channel: phoneChannel(deps.auth.sms) }) : null;
  const byEmail = deps.auth.email
    ? new OtpService({ ...options, channel: emailChannel(deps.auth.email) })
    : null;

  const unavailable = (how: string) =>
    new ApiError(
      503,
      ErrorCode.providerUnavailable,
      `Codes by ${how} are not available`,
      'Try the other way.',
    );

  /** Only a 13–17 account still waiting for consent may ask. */
  async function waiting(userId: string): Promise<void> {
    const user = (
      await pool.query<{ status: string; guardian_consent_at: Date | null }>(
        'SELECT status, guardian_consent_at FROM users WHERE id = $1',
        [userId],
      )
    ).rows[0];
    if (user?.status !== 'restricted') {
      throw conflict(
        ErrorCode.conflict,
        'No guardian needed',
        'Only accounts for players under 18 need one.',
      );
    }
    if (user.guardian_consent_at) {
      throw conflict(ErrorCode.conflict, 'Your parent or guardian already agreed', 'You can carry on.');
    }
  }

  const codeSendLimit = { config: { rateLimit: { max: config.otpSendsPerIpPerHour, timeWindow: '1 hour' } } };

  app.post('/v1/me/guardian/send', codeSendLimit, async (request): Promise<OtpSendResponse> => {
    const { userId } = requireAuth(request);
    const body = parse(GuardianSendRequest, request.body);
    await waiting(userId);
    let to: string;
    let codes: OtpService;
    if (body.phone !== undefined) {
      if (!byPhone) throw unavailable('text');
      codes = byPhone;
      const phone = normalizeNigerianPhone(body.phone);
      if (!phone) {
        throw new ApiError(
          400,
          ErrorCode.validation,
          'The request is not valid',
          'phone: enter a Nigerian mobile number, like 0803 123 4567.',
        );
      }
      to = phone;
    } else {
      if (!byEmail) throw unavailable('email');
      codes = byEmail;
      to = body.email!.toLowerCase();
    }
    // The player's own number or address can't stand in for a parent's.
    const own = await pool.query(
      `SELECT 1 FROM auth_identities
        WHERE user_id = $1 AND ((provider = 'phone' AND subject = $2) OR (provider = 'email' AND subject = $2))`,
      [userId, to],
    );
    if (own.rowCount) {
      throw new ApiError(
        400,
        ErrorCode.validation,
        "That's your own",
        "Use your parent's or guardian's number or email, not yours.",
      );
    }
    const device = await pool.query<{ subject: string }>(
      "SELECT subject FROM auth_identities WHERE user_id = $1 AND provider = 'guest_device' ORDER BY created_at LIMIT 1",
      [userId],
    );
    const sent = await codes.send({
      to,
      platform: body.platform,
      captchaToken: body.turnstile_token,
      ip: request.ip,
      deviceId: device.rows[0]?.subject ?? null,
    });
    await redis.set(askerKey(sent.requestId), userId, 'EX', CODE_TTL_SECONDS);
    return { request_id: sent.requestId, resend_after_s: RESEND_AFTER_SECONDS };
  });

  app.post('/v1/me/guardian/verify', async (request): Promise<Me> => {
    const { userId } = requireAuth(request);
    const body = parse(GuardianVerifyRequest, request.body);
    await waiting(userId);
    const [prefix] = body.request_id.split('_');
    const codes = prefix === PHONE_PREFIX ? byPhone : prefix === EMAIL_PREFIX ? byEmail : null;
    if (!codes || (await redis.get(askerKey(body.request_id))) !== userId) {
      throw new ApiError(400, ErrorCode.otpExpired, 'This code has expired', 'Ask for a new code.');
    }
    const checked = await codes.verify(body.request_id, body.code);
    if (!checked.ok) throw checked.error;
    await redis.del(askerKey(body.request_id));

    const method = prefix === PHONE_PREFIX ? 'phone' : 'email';
    const contact = checked.code.to;
    const now = new Date(clock.now());
    await withTransaction(pool, async (client) => {
      const updated = await client.query(
        `UPDATE users SET guardian_consent_at = $2, updated_at = $2
          WHERE id = $1 AND status = 'restricted' AND guardian_consent_at IS NULL`,
        [userId, now],
      );
      if (!updated.rowCount) {
        throw conflict(ErrorCode.conflict, 'Your parent or guardian already agreed', 'You can carry on.');
      }
      await client.query(
        `INSERT INTO consent_records (user_id, purpose, granted, policy_version, source, details, created_at)
         VALUES ($1, 'guardian', true, $2, 'guardian_code', $3, $4)`,
        [
          userId,
          GUARDIAN_POLICY_VERSION,
          {
            method,
            contact: method === 'phone' ? maskPhone(contact) : maskEmail(contact),
            contact_sha256: createHash('sha256').update(contact).digest('hex'),
          },
          now,
        ],
      );
    });
    await events.emit(
      'consent_changed',
      { purpose: 'guardian', granted: true },
      requestEventContext(request),
    );
    return currentMe(pool, userId, clock.now());
  });
}
