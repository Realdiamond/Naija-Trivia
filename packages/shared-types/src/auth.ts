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
