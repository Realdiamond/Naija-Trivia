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

// ----- Home banners and events (step 2.7h, doc 18 §11, doc 16 §2) -----

/** A plain Home banner, or Weekend Wahala: double XP in duels on one category (or all). */
export const LiveEventKind = z.enum(['banner', 'double_xp']);
export type LiveEventKind = z.infer<typeof LiveEventKind>;

/** The screen a Home banner opens when tapped. */
export const BannerAction = z.enum([
  'daily',
  'random',
  'party',
  'challenge',
  'leaderboards',
  'shop',
  'friends',
]);
export type BannerAction = z.infer<typeof BannerAction>;

/** A banner on Home while its event runs. */
export const HomeBanner = z.object({
  id: z.number().int(),
  kind: LiveEventKind,
  title_en: z.string(),
  /** Pidgin; English is shown when there is none. */
  title_pcm: z.string().nullable(),
  body_en: z.string().nullable(),
  body_pcm: z.string().nullable(),
  action: BannerAction.nullable(),
  /** Double XP's category; null for every category. */
  category_id: z.string().nullable(),
  ends_at: z.iso.datetime(),
});
export type HomeBanner = z.infer<typeof HomeBanner>;

/** `GET /v1/config`: the flags as they apply to this player, and the banner. Looked at again every `refresh_s`. */
export const ClientConfig = z.object({
  flags: z.record(z.string(), z.boolean()),
  banner: StatusBanner.nullable(),
  /** Home banners and events running now for this platform, newest first (step 2.7h). */
  home: z.array(HomeBanner),
  /** The tuned values the apps use too: lifeline prices, rewarded video coins, ad pacing (step 2.7g). */
  values: z.record(z.string(), z.number()),
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

// ----- Remote config: game and economy values (step 2.7g, doc 18 §11) -----

export const AdminConfigValue = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number().int(),
  default: z.number().int(),
  min: z.number().int(),
  max: z.number().int(),
  /** The apps use it too (they pick a change up within a minute). */
  client: z.boolean(),
  changed_by: z.string().nullable(),
  changed_at: z.iso.datetime().nullable(),
});
export type AdminConfigValue = z.infer<typeof AdminConfigValue>;
export const AdminConfigResponse = z.object({ values: z.array(AdminConfigValue) });
export type AdminConfigResponse = z.infer<typeof AdminConfigResponse>;

export const AdminConfigChange = z.object({
  value: z.number().int(),
  reason: z.string().trim().min(3).max(300),
});
export type AdminConfigChange = z.infer<typeof AdminConfigChange>;
/** Back to the value before the latest change. */
export const AdminConfigRollback = z.object({ reason: z.string().trim().min(3).max(300) });

export const AdminConfigHistory = z.object({
  entries: z.array(
    z.object({
      id: z.number().int(),
      /** Null before the first change: the default was in force. */
      old_value: z.number().nullable(),
      new_value: z.number(),
      changed_by: z.string(),
      reason: z.string().nullable(),
      created_at: z.iso.datetime(),
    }),
  ),
});
export type AdminConfigHistory = z.infer<typeof AdminConfigHistory>;

// ----- Home banners and events in the console (step 2.7h) -----

export const AdminLiveEvent = HomeBanner.extend({
  starts_at: z.iso.datetime(),
  /** null: every platform. */
  platforms: z.array(z.enum(['android', 'ios', 'web'])).nullable(),
  state: z.enum(['scheduled', 'live', 'ended']),
  ended_at: z.iso.datetime().nullable(),
  created_by: z.string(),
});
export type AdminLiveEvent = z.infer<typeof AdminLiveEvent>;

/** Scheduled and running events, then the last 20 that ended. */
export const AdminLiveEventsResponse = z.object({ events: z.array(AdminLiveEvent) });
export type AdminLiveEventsResponse = z.infer<typeof AdminLiveEventsResponse>;

const text = (max: number) => z.string().trim().min(3).max(max);

export const AdminLiveEventCreate = z
  .object({
    kind: LiveEventKind,
    title_en: text(60),
    title_pcm: text(60).nullable().default(null),
    body_en: text(160).nullable().default(null),
    body_pcm: text(160).nullable().default(null),
    action: BannerAction.nullable().default(null),
    category_id: z.string().min(1).max(40).nullable().default(null),
    platforms: z
      .array(z.enum(['android', 'ios', 'web']))
      .min(1)
      .nullable()
      .default(null),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    reason: text(300),
  })
  .strict()
  .refine((e) => Date.parse(e.ends_at) > Date.parse(e.starts_at), {
    message: 'it must end after it starts',
    path: ['ends_at'],
  })
  .refine((e) => Date.parse(e.ends_at) - Date.parse(e.starts_at) <= 90 * 86_400_000, {
    message: 'events run for 90 days at most',
    path: ['ends_at'],
  })
  .refine((e) => e.kind === 'double_xp' || e.category_id === null, {
    message: 'only double XP has a category',
    path: ['category_id'],
  });
export type AdminLiveEventCreate = z.input<typeof AdminLiveEventCreate>;

export const AdminLiveEventEnd = z.object({ reason: text(300) }).strict();
export type AdminLiveEventEnd = z.infer<typeof AdminLiveEventEnd>;
