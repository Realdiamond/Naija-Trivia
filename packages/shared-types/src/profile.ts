/**
 * Me, profiles and settings (doc 09 §2.2, PRD F2, TRD FR-AUTH-6).
 */
import { z } from 'zod';
import { UserStatus } from './auth';

/** Nigeria's 36 states and the FCT (ISO 3166-2:NG codes), for the optional home state. */
// prettier-ignore
export const NG_STATES = [
  'AB', 'AD', 'AK', 'AN', 'BA', 'BY', 'BE', 'BO', 'CR', 'DE', 'EB', 'ED', 'EK', 'EN', 'FC', 'GO', 'IM', 'JI', 'KD',
  'KN', 'KT', 'KE', 'KO', 'KW', 'LA', 'NA', 'NI', 'OG', 'ON', 'OS', 'OY', 'PL', 'RI', 'SO', 'TA', 'YO', 'ZA',
] as const;
export const HomeState = z.enum(NG_STATES);
export type HomeState = z.infer<typeof HomeState>;

export const Language = z.enum(['en', 'pcm', 'yo', 'ig', 'ha']);

/** 3–20 letters, digits or underscores, not only digits. The server also filters offensive names. */
export const Username = z
  .string()
  .regex(/^[A-Za-z0-9_]{3,20}$/, 'use 3–20 letters, numbers or _')
  .refine((u) => !/^\d+$/.test(u), 'use at least one letter');

/** Preset avatars (PRD F2); the list itself comes with the design system. */
export const AvatarId = z.string().regex(/^av_[a-z0-9_]{1,40}$/);

export const AgeBand = z.enum(['13_17', '18_plus']);
export type AgeBand = z.infer<typeof AgeBand>;

/** The age gate at username creation (UX §2.1): under 13 is refused, 13–17 get a restricted account. */
export const AgeBandRequest = z.object({ age_band: z.enum(['under_13', '13_17', '18_plus']) });
export type AgeBandRequest = z.infer<typeof AgeBandRequest>;

export const Tier = z.object({ id: z.string(), name: z.string(), badge: z.string() });

export const ProfileCard = z.object({
  id: z.string(),
  username: z.string().nullable(),
  avatar_id: z.string().nullable(),
  level: z.number().int(),
  tier: Tier,
});
export type ProfileCard = z.infer<typeof ProfileCard>;

/**
 * The kinds of push a player can switch off (like Android's notification channels): duels (your
 * turn, time running out, results), friends (requests) and the Daily reminder.
 */
export const PushKind = z.enum(['duels', 'friends', 'daily']);
export type PushKind = z.infer<typeof PushKind>;

/** Something the Who Sabi team told the player (step 2.7d): a warning, or a username taken away. */
export const PlayerNotice = z.object({
  id: z.number().int(),
  kind: z.enum(['warning', 'renamed']),
  /** The moderator's words, for a warning. */
  message: z.string().nullable(),
  at: z.iso.datetime(),
});
export type PlayerNotice = z.infer<typeof PlayerNotice>;

export const Me = z.object({
  id: z.string(),
  username: z.string().nullable(),
  status: UserStatus,
  avatar_id: z.string().nullable(),
  home_state: HomeState.nullable(),
  language: Language,
  /**
   * Data Saver (step 2.8b): the player's choice, or null for automatic, when the app turns it
   * on by itself if the phone or browser says data is tight (Save-Data, 2G or 3G).
   */
  data_saver: z.boolean().nullable(),
  family_mode: z.boolean(),
  discoverable: z.boolean(),
  age_band: AgeBand.nullable(),
  level: z.number().int(),
  xp: z.number().int(),
  xp_into_level: z.number().int(),
  xp_for_next_level: z.number().int(),
  rating: z.number(),
  tier: Tier,
  created_at: z.iso.datetime(),
  /** On the staff list as an owner or admin: the app shows the Staff tab (step 2.9a). */
  staff: z.boolean(),
  /** Kinds of push switched off in the app (step 2.5c). */
  push_off: z.array(PushKind),
  /** Not seen yet, oldest first (step 2.7d). */
  notices: z.array(PlayerNotice),
});
export type Me = z.infer<typeof Me>;

/**
 * Changes to your profile and settings. The username is chosen once (support handles changes,
 * doc 16); restricted (13–17) accounts keep family mode on and stay out of contact discovery.
 */
export const UpdateMeRequest = z
  .object({
    username: Username,
    avatar_id: AvatarId,
    home_state: HomeState.nullable(),
    language: Language,
    /** null goes back to automatic. */
    data_saver: z.boolean().nullable(),
    family_mode: z.boolean(),
    discoverable: z.boolean(),
    push_off: z.array(PushKind).max(3),
  })
  .partial()
  .strict();
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>;

/** What a consent is for (doc 10 §2). Guardian consent has its own flow (step 2.8). */
export const ConsentPurpose = z.enum([
  'terms',
  'privacy',
  'analytics',
  'marketing_push',
  'ads_personalisation',
  'contacts',
  'session_replay',
]);
export type ConsentPurpose = z.infer<typeof ConsentPurpose>;

/**
 * Consent choices (doc 09 §2.2, doc 10 §2), kept as a history: every change is a new record
 * with the policy version it was given under and where it was given.
 */
export const ConsentsRequest = z
  .object({
    source: z.enum(['onboarding', 'settings', 'web_banner']),
    consents: z
      .array(
        z
          .object({
            purpose: ConsentPurpose,
            granted: z.boolean(),
            policy_version: z.string().min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
export type ConsentsRequest = z.infer<typeof ConsentsRequest>;

/** Round-trip sampling (TRD §5.3): ping, then answer straight away. */
export const PingResponse = z.object({ ping_id: z.string(), server_time: z.iso.datetime() });
export type PingResponse = z.infer<typeof PingResponse>;

export const PongResponse = z.object({ rtt_ms: z.number().int(), rtt_est_ms: z.number().int() });
export type PongResponse = z.infer<typeof PongResponse>;

/** An FCM registration token: letters, digits and `:_-`, in practice about 160 characters. */
const PushToken = z
  .string()
  .min(20)
  .max(4096)
  .regex(/^[A-Za-z0-9:_-]+$/);

/** A browser's push endpoint (web push, step 2.5c): an https address at its push service. */
const PushEndpoint = z.url({ protocol: /^https$/ }).max(1024);
const Base64Url = z.string().regex(/^[A-Za-z0-9_-]+=*$/);

/** What `PushSubscription.toJSON()` gives in the browser. */
export const WebPushSubscription = z.object({
  endpoint: PushEndpoint,
  keys: z.object({ p256dh: Base64Url.min(86).max(90), auth: Base64Url.min(22).max(24) }),
});
export type WebPushSubscription = z.infer<typeof WebPushSubscription>;

/**
 * Turn pushes on for this phone or browser (doc 09 §2.2, FR-NOT-1). Sent on every start, since the
 * token can change; it moves to whoever is signed in there. iOS joins with its build (step 2.8).
 */
export const RegisterDeviceRequest = z.discriminatedUnion('platform', [
  z
    .object({
      platform: z.literal('android'),
      push_token: PushToken,
      app_version: z.string().max(20).optional(),
      model: z.string().max(60).optional(),
    })
    .strict(),
  z
    .object({
      platform: z.literal('web'),
      subscription: WebPushSubscription,
      app_version: z.string().max(20).optional(),
      /** e.g. chrome_android, safari_ios. */
      browser: z.string().max(40).optional(),
    })
    .strict(),
]);
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequest>;

/** Turn pushes off for this phone or browser (its token or endpoint): on sign-out. */
export const ForgetDeviceRequest = z.object({ push_token: PushToken.or(PushEndpoint) }).strict();
export type ForgetDeviceRequest = z.infer<typeof ForgetDeviceRequest>;

/** The key browsers subscribe with; null while web push is off. */
export const WebPushKeyResponse = z.object({ public_key: z.string().nullable() });
export type WebPushKeyResponse = z.infer<typeof WebPushKeyResponse>;

/** Deleting your account (step 2.8a): at once and for good, so the app asks the player to confirm. */
export const DeleteAccountRequest = z.object({ confirm: z.literal(true) });
export const DeleteAccountResponse = z.object({ dsar_id: z.string() });
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponse>;
