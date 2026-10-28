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

export const Me = z.object({
  id: z.string(),
  username: z.string().nullable(),
  status: UserStatus,
  avatar_id: z.string().nullable(),
  home_state: HomeState.nullable(),
  language: Language,
  data_saver: z.boolean(),
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
    data_saver: z.boolean(),
    family_mode: z.boolean(),
    discoverable: z.boolean(),
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
