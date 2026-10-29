/**
 * LiveOps (doc 18 §11, build plan step 2.7c): what each app is told about flags, kill switches
 * and the status banner, and the console's calls to change them.
 */
import { z } from 'zod';

export const StatusBanner = z.object({
  /** 'warning' for a problem players can see (party rooms down); 'info' for news. */
  level: z.enum(['info', 'warning']),
  text_en: z.string().trim().min(3).max(160),
  /** Pidgin; English is shown when there is none. */
  text_pcm: z.string().trim().min(3).max(160).nullable(),
});
export type StatusBanner = z.infer<typeof StatusBanner>;

/** `GET /v1/config`: the flags as they apply to this player, and the banner. Looked at again every `refresh_s`. */
export const ClientConfig = z.object({
  flags: z.record(z.string(), z.boolean()),
  banner: StatusBanner.nullable(),
  refresh_s: z.number().int(),
});
export type ClientConfig = z.infer<typeof ClientConfig>;

export const AdminFlagRule = z.object({
  platform: z.enum(['android', 'ios', 'web']).optional(),
  min_app_version: z
    .string()
    .regex(/^\d+(\.\d+){0,3}$/, 'a version like 1.2.0')
    .optional(),
  percent: z.number().int().min(0).max(100).optional(),
});
export type AdminFlagRule = z.infer<typeof AdminFlagRule>;

export const AdminFlag = z.object({
  key: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  rules: z.array(AdminFlagRule),
  /** A kill switch: on unless staff switch it off. */
  kill_switch: z.boolean(),
  updated_by: z.string().nullable(),
  updated_at: z.iso.datetime(),
});
export type AdminFlag = z.infer<typeof AdminFlag>;

export const AdminFlagsResponse = z.object({ flags: z.array(AdminFlag) });
export type AdminFlagsResponse = z.infer<typeof AdminFlagsResponse>;

export const AdminFlagUpdate = z.object({
  enabled: z.boolean(),
  rules: z.array(AdminFlagRule).max(10),
  reason: z.string().trim().min(3).max(300),
});
export type AdminFlagUpdate = z.infer<typeof AdminFlagUpdate>;

export const AdminBannerResponse = z.object({
  banner: StatusBanner.nullable(),
  updated_by: z.string().nullable(),
  updated_at: z.iso.datetime().nullable(),
});
export type AdminBannerResponse = z.infer<typeof AdminBannerResponse>;

/** Put a banner up (with `banner`) or take it down (`banner: null`), always with a reason. */
export const AdminBannerUpdate = z.object({
  banner: StatusBanner.nullable(),
  reason: z.string().trim().min(3).max(300),
});
export type AdminBannerUpdate = z.infer<typeof AdminBannerUpdate>;
