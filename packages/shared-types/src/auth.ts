import { z } from 'zod';
import { Platform } from './common';

/** A random install id (app) or browser id (web), at least 128 bits, URL-safe. */
export const DeviceId = z
  .string()
  .min(22)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const GuestAuthRequest = z.object({
  device_id: DeviceId,
  platform: Platform,
});
export type GuestAuthRequest = z.infer<typeof GuestAuthRequest>;

export const UserStatus = z.enum(['guest', 'active', 'restricted', 'banned', 'deleted']);

export const PublicUser = z.object({
  id: z.string(),
  username: z.string().nullable(),
  status: UserStatus,
  level: z.number().int(),
  xp: z.number().int(),
});
export type PublicUser = z.infer<typeof PublicUser>;

/**
 * Tokens for a session. `refresh` is only in the body for the apps; on the web it is an
 * HttpOnly cookie and never reaches JavaScript (TRD FR-AUTH-7).
 */
export const AuthResponse = z.object({
  access: z.string(),
  access_expires_in: z.number().int(),
  refresh: z.string().optional(),
  user: PublicUser,
});
export type AuthResponse = z.infer<typeof AuthResponse>;

/** The apps send the refresh token in the body; the web sends no body and relies on the cookie. */
export const RefreshRequest = z.object({
  refresh: z.string().min(20).max(200).optional(),
});
export type RefreshRequest = z.infer<typeof RefreshRequest>;

/** Phone sign-in, step 1 (doc 09 §2.1, TRD FR-AUTH-2). The platform picks the SMS format. */
export const OtpSendRequest = z.object({
  /** A Nigerian mobile number in any common format; the server normalises it to E.164. */
  phone: z.string().min(7).max(24),
  platform: Platform,
  /** Cloudflare Turnstile: always on the web, and in the apps from a number's third code of the day. */
  turnstile_token: z.string().min(1).max(4096).optional(),
});
export type OtpSendRequest = z.infer<typeof OtpSendRequest>;

export const OtpSendResponse = z.object({
  request_id: z.string(),
  /** Wait this long before offering "Send again". */
  resend_after_s: z.number().int(),
});
export type OtpSendResponse = z.infer<typeof OtpSendResponse>;

/**
 * Sign-in requests take `merge_guest` (default true): send the current session's access token
 * with it, and a guest keeps their progress (FR-AUTH-4) while an account gets the new
 * sign-in method linked (FR-AUTH-8).
 */
export const OtpVerifyRequest = z.object({
  request_id: z.string().min(10).max(64),
  code: z.string().regex(/^\d{6}$/),
  merge_guest: z.boolean().default(true),
});
export type OtpVerifyRequest = z.infer<typeof OtpVerifyRequest>;

export const GoogleAuthRequest = z.object({
  id_token: z.string().min(20).max(8192),
  platform: Platform,
  merge_guest: z.boolean().default(true),
});
export type GoogleAuthRequest = z.infer<typeof GoogleAuthRequest>;

export const AppleAuthRequest = z.object({
  identity_token: z.string().min(20).max(8192),
  /** The raw nonce; Apple puts its SHA-256 in the token. */
  nonce: z.string().min(8).max(256),
  platform: Platform,
  merge_guest: z.boolean().default(true),
});
export type AppleAuthRequest = z.infer<typeof AppleAuthRequest>;

export const SignInResponse = AuthResponse.extend({
  /** A new account (including a guest who just signed up). */
  is_new: z.boolean(),
  /** The guest's progress was kept, in this account. */
  merged_guest: z.boolean(),
});
export type SignInResponse = z.infer<typeof SignInResponse>;
