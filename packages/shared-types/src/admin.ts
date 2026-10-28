/**
 * The admin console API (doc 09 §2.10, doc 18): staff sign-in, roles, player search, User 360,
 * the activity timeline and the audit log. Served by the core API under /admin, only to staff
 * sessions; every request is checked on the server and written to the audit log.
 */
import { z } from 'zod';
import { UserStatus } from './auth';
import { Platform } from './common';
import { AgeBand, Tier } from './profile';

/** Doc 18 §3. Roles combine; anything not granted is denied. */
export const AdminRole = z.enum([
  'owner',
  'admin',
  'analyst',
  'growth',
  'liveops',
  'editor',
  'fact_checker',
  'writer',
  'moderator',
  'support',
  'finance',
  'sponsor_manager',
  'dpo',
  'engineer',
  'viewer',
]);
export type AdminRole = z.infer<typeof AdminRole>;

/** Granting these needs a second approver (four eyes), and nobody approves their own grant. */
export const PRIVILEGED_ROLES: readonly AdminRole[] = ['owner', 'admin', 'finance', 'dpo'];

/** What the console's v0 screens need; more arrive with each admin module (step 2.7). */
export const AdminPermission = z.enum([
  'players.search',
  'players.view',
  /** Search by full phone number (exact match only, logged). */
  'players.search_phone',
  'pii.reveal',
  'audit.view',
  'staff.manage',
]);
export type AdminPermission = z.infer<typeof AdminPermission>;

export const AdminProfile = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  roles: z.array(AdminRole),
  permissions: z.array(AdminPermission),
});
export type AdminProfile = z.infer<typeof AdminProfile>;

export const AdminGoogleSignIn = z.object({ id_token: z.string().min(20).max(8192) });
/** Development and tests only: the API refuses it in production. */
export const AdminDevSignIn = z.object({ email: z.email() });

export const AdminSessionResponse = z.object({
  token: z.string(),
  expires_at: z.iso.datetime(),
  admin: AdminProfile,
});
export type AdminSessionResponse = z.infer<typeof AdminSessionResponse>;

// ----- Players -----

export const AdminUserSearchQuery = z.object({ q: z.string().trim().min(2).max(100) });

export const AdminUserHit = z.object({
  id: z.string(),
  username: z.string().nullable(),
  status: UserStatus,
  level: z.number().int(),
  last_seen_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  /** How the search found them. */
  matched: z.enum(['username', 'user_id', 'phone', 'device_id', 'duel_id']),
});
export type AdminUserHit = z.infer<typeof AdminUserHit>;

export const AdminUserSearchResponse = z.object({ users: z.array(AdminUserHit) });
export type AdminUserSearchResponse = z.infer<typeof AdminUserSearchResponse>;

export const AdminSignInMethod = z.object({
  provider: z.enum(['phone', 'google', 'apple', 'guest_device']),
  /** Masked: `+234 80• ••• 4567` for phones; never the full value. */
  masked: z.string(),
  created_at: z.iso.datetime(),
});

export const AdminConsent = z.object({
  purpose: z.string(),
  granted: z.boolean(),
  policy_version: z.string(),
  source: z.string(),
  created_at: z.iso.datetime(),
});

export const AdminUserSummary = z.object({
  id: z.string(),
  username: z.string().nullable(),
  status: UserStatus,
  avatar_id: z.string().nullable(),
  age_band: AgeBand.nullable(),
  home_state: z.string().nullable(),
  language: z.string(),
  family_mode: z.boolean(),
  discoverable: z.boolean(),
  level: z.number().int(),
  xp: z.number().int(),
  rating: z.number(),
  tier: Tier,
  signup_platform: Platform.nullable(),
  last_platform: Platform.nullable(),
  acquisition_source: z.string().nullable(),
  last_seen_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  sign_in_methods: z.array(AdminSignInMethod),
  /** Guests who signed in to this account: their events are part of this timeline (doc 18 AD-3). */
  merged_guests: z.array(z.string()),
  friends: z.number().int(),
  duels: z.object({
    active: z.number().int(),
    won: z.number().int(),
    lost: z.number().int(),
    drawn: z.number().int(),
  }),
  /** The latest choice for each purpose. */
  consents: z.array(AdminConsent),
});
export type AdminUserSummary = z.infer<typeof AdminUserSummary>;

export const AdminTimelineQuery = z.object({
  /** Events before this time (the next page). */
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const AdminTimelineEvent = z.object({
  event_id: z.string(),
  event: z.string(),
  source: z.enum(['client', 'server']),
  ts: z.iso.datetime(),
  session_id: z.string(),
  platform: z.string(),
  app_version: z.string(),
  screen: z.string(),
  props: z.record(z.string(), z.unknown()),
});
export type AdminTimelineEvent = z.infer<typeof AdminTimelineEvent>;

export const AdminTimelineResponse = z.object({
  events: z.array(AdminTimelineEvent),
  /** Pass back as `before` for older events; null when there are none. */
  next_before: z.iso.datetime().nullable(),
});
export type AdminTimelineResponse = z.infer<typeof AdminTimelineResponse>;

/** Doc 18 §7.2: the full value needs the right role and a reason, and is logged. */
export const AdminRevealRequest = z.object({
  field: z.literal('phone'),
  reason: z.string().trim().min(5).max(500),
});
export const AdminRevealResponse = z.object({ field: z.literal('phone'), value: z.string().nullable() });
export type AdminRevealResponse = z.infer<typeof AdminRevealResponse>;

// ----- Audit log and staff -----

export const AdminAuditQuery = z.object({
  entity: z.string().max(40).optional(),
  entity_id: z.string().max(80).optional(),
  actor: z.string().max(80).optional(),
  /** Entries older than this id (the next page). */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const AdminAuditEntry = z.object({
  id: z.number().int(),
  actor: z.string(),
  actor_email: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entity_id: z.string().nullable(),
  reason: z.string().nullable(),
  ip: z.string().nullable(),
  created_at: z.iso.datetime(),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntry>;

export const AdminAuditResponse = z.object({
  entries: z.array(AdminAuditEntry),
  next_before: z.number().int().nullable(),
});
export type AdminAuditResponse = z.infer<typeof AdminAuditResponse>;

export const AdminRoleGrant = z.object({
  role: AdminRole,
  granted_by: z.string(),
  /** False while a privileged role waits for its second approver. */
  active: z.boolean(),
  approved_by: z.string().nullable(),
  expires_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
});

export const AdminStaffMember = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  status: z.enum(['active', 'suspended', 'removed']),
  last_login_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  grants: z.array(AdminRoleGrant),
});
export type AdminStaffMember = z.infer<typeof AdminStaffMember>;

export const AdminStaffResponse = z.object({ staff: z.array(AdminStaffMember) });
export type AdminStaffResponse = z.infer<typeof AdminStaffResponse>;

export const AdminAddStaff = z.object({ email: z.email(), name: z.string().trim().min(1).max(100) }).strict();
export const AdminGrantRole = z
  .object({
    role: AdminRole,
    expires_at: z.iso.datetime().optional(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
