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
  /** The question bank and its live performance. */
  'content.view',
  /** Write and edit drafts, and send them for review. */
  'content.write',
  /** Fact-check: approve someone else's question, or send it back. */
  'content.review',
  /** Publish, suspend, retire and edit live questions; resolve player reports. */
  'content.publish',
  /** Import questions from a CSV file. */
  'content.import',
  /** Live numbers: players online, sign-ups, games and Daily players today, work waiting. */
  'overview.view',
  /** Remove a player from a live party room, or close the room (step 2.7a). */
  'live.manage',
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

/**
 * Staff tools on a phone (step 2.9a): a Google ID token from the app's own sign-in, and a name
 * for the phone so the console can list it. Owners and admins only, for now.
 */
export const AdminPhoneSignIn = z
  .object({ id_token: z.string().min(20).max(8192), label: z.string().trim().min(1).max(60) })
  .strict();
/** Development and tests only: the API refuses it in production. */
export const AdminPhoneDevSignIn = z
  .object({ email: z.email(), label: z.string().trim().min(1).max(60) })
  .strict();

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
  matched: z.enum(['username', 'user_id', 'phone', 'email', 'device_id', 'duel_id']),
});
export type AdminUserHit = z.infer<typeof AdminUserHit>;

export const AdminUserSearchResponse = z.object({ users: z.array(AdminUserHit) });
export type AdminUserSearchResponse = z.infer<typeof AdminUserSearchResponse>;

export const AdminSignInMethod = z.object({
  provider: z.enum(['phone', 'email', 'google', 'apple', 'guest_device']),
  /** Masked: `+234 80• ••• 4567` for phones, `c•••@gmail.com` for email; never the full value. */
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

// ----- Staff phones (step 2.9a) -----

export const AdminPhone = z.object({
  id: z.string(),
  admin_id: z.string(),
  admin_name: z.string(),
  label: z.string(),
  created_at: z.iso.datetime(),
  last_used_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  /** The phone making this request. */
  current: z.boolean(),
});
export type AdminPhone = z.infer<typeof AdminPhone>;

export const AdminPhonesResponse = z.object({ phones: z.array(AdminPhone) });
export type AdminPhonesResponse = z.infer<typeof AdminPhonesResponse>;

// ----- Live numbers (step 2.9a; the console's Overview grows from it in 2.7) -----

/** Today so far (WAT) against yesterday up to the same time. */
export const AdminCount = z.object({ today: z.number().int(), yesterday: z.number().int() });
export type AdminCount = z.infer<typeof AdminCount>;

export const AdminOverview = z.object({
  at: z.iso.datetime(),
  /** Players seen in the last 10 minutes. */
  online_now: z.number().int(),
  /** Guests made accounts (Google or phone). */
  signups: AdminCount,
  /** New players, guests included. */
  new_players: AdminCount,
  duels_started: AdminCount,
  duels_finished: AdminCount,
  daily_players: AdminCount,
  /** Work waiting: questions with open player reports, in review, and approved but not live. */
  waiting: z.object({
    reported_questions: z.number().int(),
    in_review: z.number().int(),
    approved: z.number().int(),
  }),
});
export type AdminOverview = z.infer<typeof AdminOverview>;

// ----- Staff alerts (step 2.9b) -----

/** What staff can be alerted about; each can be switched off in the Staff tab. */
export const StaffAlertKind = z.enum([
  'problem',
  'signup',
  'payment_opened',
  'payment_started',
  'payment_paid',
]);
export type StaffAlertKind = z.infer<typeof StaffAlertKind>;

export const StaffAlert = z.object({
  id: z.string(),
  kind: StaffAlertKind,
  title: z.string(),
  body: z.string(),
  /** Where tapping it goes in the Staff tab, e.g. /staff/player/u_123. */
  url: z.string().nullable(),
  created_at: z.iso.datetime(),
  unread: z.boolean(),
});
export type StaffAlert = z.infer<typeof StaffAlert>;

export const StaffAlertsQuery = z.object({ before: z.coerce.number().int().positive().optional() });
export const StaffAlertsResponse = z.object({
  alerts: z.array(StaffAlert),
  unread: z.number().int(),
  /** Pass back as `before` for older alerts; null when there are none. */
  next_before: z.string().nullable(),
});
export type StaffAlertsResponse = z.infer<typeof StaffAlertsResponse>;

export const StaffAlertsSeen = z.object({ up_to: z.coerce.number().int().positive() }).strict();

export const StaffAlertSetting = z.object({
  kind: StaffAlertKind,
  label: z.string(),
  description: z.string(),
  enabled: z.boolean(),
});
export type StaffAlertSetting = z.infer<typeof StaffAlertSetting>;

export const StaffAlertSettingsResponse = z.object({ settings: z.array(StaffAlertSetting) });
export type StaffAlertSettingsResponse = z.infer<typeof StaffAlertSettingsResponse>;

export const UpdateStaffAlertSetting = z.object({ kind: StaffAlertKind, enabled: z.boolean() }).strict();

/** The phone's push token, so staff alerts reach this phone (phone sessions only). */
export const StaffPhonePush = z
  .object({
    push_token: z
      .string()
      .min(20)
      .max(4096)
      .regex(/^[A-Za-z0-9:_-]+$/),
  })
  .strict();

// ----- The console's Overview and Live (step 2.7a, doc 18 §5–6) -----

/** Today so far (WAT) against the same span a week ago. */
export const WeekCount = z.object({ today: z.number().int(), last_week: z.number().int() });
export type WeekCount = z.infer<typeof WeekCount>;

export const ConsoleOverview = z.object({
  at: z.iso.datetime(),
  /** Players seen in the last 5 minutes, and players active in each of the last 24 hours (oldest first). */
  online: z.object({
    total: z.number().int(),
    android: z.number().int(),
    ios: z.number().int(),
    web: z.number().int(),
    last_24h: z.array(z.number().int()),
  }),
  today: z.object({
    active_players: WeekCount,
    new_players: WeekCount,
    signups: WeekCount,
    duels_finished: WeekCount,
    party_games: WeekCount,
    dailies: WeekCount,
  }),
  /** From the app's foreground time; null before anyone has played today. */
  time: z.object({
    minutes_per_player: z.number().nullable(),
    median_session_minutes: z.number().nullable(),
  }),
  money: z.object({
    purchases: z.number().int(),
    /** Real store purchases in Naira, before the store's cut. */
    revenue_ngn: z.number().int(),
    test_purchases: z.number().int(),
    rewarded_ads: z.number().int(),
    coins_earned: z.number().int(),
    coins_spent: z.number().int(),
  }),
  live: z.object({
    party_rooms: z.number().int(),
    party_players: z.number().int(),
    duels_waiting: z.number().int(),
  }),
  health: z.object({
    /** Analytics events waiting to be loaded. */
    events_waiting: z.number().int(),
    /** Seconds since the newest event was loaded; null if none ever was. */
    last_event_loaded_s: z.number().int().nullable(),
  }),
  queues: z.object({
    reported_questions: z.number().int(),
    suspended_questions: z.number().int(),
    open_flags: z.number().int(),
    dsars_due: z.number().int(),
  }),
  /** Problems raised in the last 24 hours, newest first. */
  alerts: z.array(z.object({ title: z.string(), body: z.string(), created_at: z.iso.datetime() })),
  charts: z.object({
    active_30d: z.array(z.object({ day: z.iso.date(), players: z.number().int() })),
    by_hour: z.array(
      z.object({ hour: z.number().int(), today: z.number().int(), last_week: z.number().int() }),
    ),
    top_states: z.array(z.object({ state: z.string(), players: z.number().int() })),
    top_categories: z.array(z.object({ category: z.string(), answers: z.number().int() })),
    new_by_source: z.array(z.object({ source: z.string(), players: z.number().int() })),
  }),
});
export type ConsoleOverview = z.infer<typeof ConsoleOverview>;

export const LiveOnlinePlayer = z.object({
  id: z.string(),
  /** Null for guests. */
  username: z.string().nullable(),
  platform: z.enum(['android', 'ios', 'web']).nullable(),
  level: z.number().int(),
  home_state: z.string().nullable(),
  last_seen_at: z.iso.datetime(),
});
export const LiveOnlineQuery = z.object({ platform: z.enum(['android', 'ios', 'web']).optional() });
export const LiveOnline = z.object({
  total: z.number().int(),
  /** The 100 seen most recently. */
  players: z.array(LiveOnlinePlayer),
  by_state: z.array(z.object({ state: z.string(), players: z.number().int() })),
});
export type LiveOnline = z.infer<typeof LiveOnline>;

export const LiveRoomPlayer = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['app', 'web', 'web_guest']),
  connected: z.boolean(),
  score: z.number().int(),
});
export const LiveRoom = z.object({
  code: z.string(),
  host: z.string(),
  phase: z.string(),
  /** 1-based while a question is on; null in the lobby or on the podium. */
  question: z.number().int().nullable(),
  questions: z.number().int(),
  players: z.array(LiveRoomPlayer),
  screens: z.number().int(),
  locked: z.boolean(),
  age_s: z.number().int(),
});
export type LiveRoom = z.infer<typeof LiveRoom>;
export const LiveRooms = z.object({ rooms: z.array(LiveRoom) });
export type LiveRooms = z.infer<typeof LiveRooms>;
export const LiveRoomKick = z.object({
  player_id: z.string().min(1).max(60),
  reason: z.string().trim().min(3).max(300),
});
export const LiveRoomClose = z.object({ reason: z.string().trim().min(3).max(300) });

/** What just happened, without anything that names a player. */
export const LiveFeedItem = z.object({
  id: z.string(),
  at: z.iso.datetime(),
  platform: z.string(),
  text: z.string(),
});
export const LiveFeedQuery = z.object({ after: z.iso.datetime().optional() });
export const LiveFeed = z.object({ items: z.array(LiveFeedItem) });
export type LiveFeed = z.infer<typeof LiveFeed>;
