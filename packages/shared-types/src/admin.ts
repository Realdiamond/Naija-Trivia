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
  /** Support's actions on a player (step 2.7b): coins (within limits), a streak, signing out; notes. */
  'players.support',
  /** Flags, kill switches and the status banner (step 2.7c). */
  'liveops.flags',
  /** Warn, rename, hide from boards, ban; the integrity queue (step 2.7d). */
  'players.moderate',
  /** The Daily scheduler: plan the next 30 Dailies and swap their questions (step 2.7f). */
  'liveops.daily',
  /** Game and economy values, with history and rollback (step 2.7g). */
  'liveops.config',
  /** The data request queue and a player's data export (step 2.8a). */
  'compliance.view',
  /** Erasing a player's account for them (step 2.8a): the DPO and owners. */
  'compliance.erase',
  /** Store purchases, refunds and the monthly export for finance (step 2.7i). */
  'commerce.view',
  /** The KPI dashboards: Engagement & time, Growth & invites, Retention (step 2.7j). */
  'analytics.kpi',
  /** The Gameplay dashboard (step 2.7k). */
  'analytics.product',
  /** The Monetisation and Economy dashboards (step 2.7k). */
  'analytics.money',
  /** Content performance (step 2.7l). */
  'analytics.content',
  /** Platforms & tech health (step 2.7l). */
  'analytics.tech',
  /** The Integrity dashboard (step 2.7l). */
  'analytics.integrity',
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
  /** Step 2.7b. */
  coins: z.number().int(),
  gems: z.number().int(),
  /** The Daily streak as it stands today (0 once it can no longer be saved). */
  streak: z.object({
    current: z.number().int(),
    best: z.number().int(),
    last_play_date: z.iso.date().nullable(),
  }),
  /** Completed store purchases, in Naira (a sale in another currency counts at the pack's price). */
  lifetime_spend_ngn: z.number().int(),
  open_flags: z.number().int(),
  notes: z.number().int(),
  /** Step 2.7d: a ban's end (null and status 'banned' is for good), and the shadow restriction. */
  banned_until: z.iso.datetime().nullable(),
  hidden_from_boards: z.boolean(),
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

// ----- User 360's other tabs and support's actions (step 2.7b, doc 18 §7.2 and §8) -----

export const AdminSession = z.object({
  id: z.string(),
  started_at: z.iso.datetime(),
  ended_at: z.iso.datetime(),
  /** Time with the app in front, from app_backgrounded; null if it never went to the background. */
  foreground_minutes: z.number().nullable(),
  platform: z.string(),
  app_version: z.string(),
  network: z.string(),
  events: z.number().int(),
});
export const AdminSessionsResponse = z.object({
  /** The latest 50. */
  sessions: z.array(AdminSession),
  /** Minutes in front each WAT day for the last 90 days (oldest first), split at midnight. */
  minutes_by_day: z.array(z.object({ day: z.iso.date(), minutes: z.number() })),
  minutes_by_platform: z.array(z.object({ platform: z.string(), minutes: z.number() })),
  /** Minutes by area of the app ('duel', 'party', 'daily', 'shop', 'home', ...); needs behaviour consent. */
  minutes_by_area: z.array(z.object({ area: z.string(), minutes: z.number() })),
  /** Average minutes in front per session, over the last 90 days. */
  average_session_minutes: z.number(),
  /** Events by WAT hour of day (24 numbers), over the last 90 days. */
  by_hour: z.array(z.number().int()),
});
export type AdminSessionsResponse = z.infer<typeof AdminSessionsResponse>;

export const AdminMatchesResponse = z.object({
  duels: z.array(
    z.object({
      id: z.string(),
      opponent: z.string().nullable(),
      source: z.string(),
      state: z.string(),
      result: z.enum(['win', 'loss', 'draw']).nullable(),
      score: z.object({ you: z.number().int(), opponent: z.number().int() }),
      coins: z.number().int().nullable(),
      created_at: z.iso.datetime(),
      completed_at: z.iso.datetime().nullable(),
    }),
  ),
  dailies: z.array(
    z.object({
      id: z.number().int(),
      date: z.iso.date(),
      score: z.number().int(),
      correct: z.number().int(),
      grid: z.string(),
      streak: z.number().int(),
      coins: z.number().int(),
    }),
  ),
  party_games: z.array(
    z.object({
      id: z.string(),
      room_code: z.string(),
      rank: z.number().int(),
      score: z.number().int(),
      players: z.number().int(),
      ended_at: z.iso.datetime().nullable(),
    }),
  ),
});
export type AdminMatchesResponse = z.infer<typeof AdminMatchesResponse>;

export const AdminMoneyResponse = z.object({
  coins: z.number().int(),
  gems: z.number().int(),
  ledger: z.array(
    z.object({
      id: z.string(),
      amount: z.number().int(),
      currency: z.string(),
      reason: z.string(),
      ref_type: z.string().nullable(),
      ref_id: z.string().nullable(),
      created_at: z.iso.datetime(),
    }),
  ),
  purchases: z.array(
    z.object({
      id: z.string(),
      store: z.string(),
      product_id: z.string(),
      coins: z.number().int().nullable(),
      /** As the store charged it, e.g. '₦1,500'. */
      price: z.string().nullable(),
      status: z.string(),
      environment: z.string(),
      created_at: z.iso.datetime(),
      refunded_at: z.iso.datetime().nullable(),
    }),
  ),
  ad_rewards: z.array(
    z.object({
      source: z.string(),
      ad_unit: z.string(),
      amount: z.number().int(),
      received_at: z.iso.datetime(),
    }),
  ),
});
export type AdminMoneyResponse = z.infer<typeof AdminMoneyResponse>;

export const AdminDevicesResponse = z.object({
  devices: z.array(
    z.object({
      platform: z.string(),
      model: z.string().nullable(),
      browser: z.string().nullable(),
      app_version: z.string().nullable(),
      push: z.boolean(),
      last_seen_at: z.iso.datetime(),
    }),
  ),
});
export type AdminDevicesResponse = z.infer<typeof AdminDevicesResponse>;

export const AdminNote = z.object({
  id: z.number().int(),
  author: z.string(),
  body: z.string(),
  created_at: z.iso.datetime(),
});
export const AdminNotesResponse = z.object({ notes: z.array(AdminNote) });
export type AdminNotesResponse = z.infer<typeof AdminNotesResponse>;
export const AdminNoteRequest = z.object({ body: z.string().trim().min(1).max(2000) });
export type AdminNoteRequest = z.infer<typeof AdminNoteRequest>;

const Reason = z.string().trim().min(3).max(300);

/**
 * Doc 18 §8: what staff can do for or about a player, always with a reason. Support grants coins,
 * restores a streak and signs out (`players.support`); moderators warn, rename, hide from the
 * boards and ban (`players.moderate`, step 2.7d).
 */
export const AdminPlayerAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('grant_coins'), amount: z.number().int().min(1).max(5000), reason: Reason }),
  z.object({ type: z.literal('restore_streak'), reason: Reason }),
  z.object({ type: z.literal('sign_out'), reason: Reason }),
  /** The player reads `message` the next time they open the game. */
  z.object({ type: z.literal('warn'), message: z.string().trim().min(10).max(500), reason: Reason }),
  /** Takes the username away; the player picks a new one. */
  z.object({ type: z.literal('rename'), reason: Reason }),
  /** Doc 10 §2's first step: still playing, left off the boards other players see. */
  z.object({ type: z.literal('shadow_restrict'), reason: Reason }),
  z.object({ type: z.literal('unrestrict'), reason: Reason }),
  /** `days: null` is for good; more than 30 days needs an admin (doc 18 §8). */
  z.object({ type: z.literal('ban'), days: z.number().int().min(1).max(3650).nullable(), reason: Reason }),
  z.object({ type: z.literal('unban'), reason: Reason }),
]);
export const SUPPORT_ACTIONS = ['grant_coins', 'restore_streak', 'sign_out'] as const;
/** Moderators ban for up to this long; longer, or for good, needs an admin or owner. */
export const MODERATOR_BAN_DAYS = 30;
/** Doc 18 §8: support grants up to 500 coins per player per WAT day; owners and admins up to 5,000. */
export const SUPPORT_GRANT_DAILY_LIMIT = 500;
export const ADMIN_GRANT_DAILY_LIMIT = 5000;
export type AdminPlayerAction = z.infer<typeof AdminPlayerAction>;
export const AdminPlayerActionResponse = z.object({ done: z.string() });
export type AdminPlayerActionResponse = z.infer<typeof AdminPlayerActionResponse>;

// ----- Safety: moderation and the integrity queue (step 2.7d, doc 18 §7.2 and §12) -----

export const AdminModerationEntry = z.object({
  id: z.number().int(),
  action: z.string(),
  reason: z.string(),
  message: z.string().nullable(),
  ends_at: z.iso.datetime().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  actor: z.string(),
  created_at: z.iso.datetime(),
  /** When the player saw what they were told. */
  seen_at: z.iso.datetime().nullable(),
});

export const IntegrityKind = z.enum([
  'accuracy_outlier',
  'timing_anomaly',
  'tab_hidden',
  'multi_account',
  'collusion',
  'ad_reward_abuse',
  'question_scraping',
  'otp_abuse',
]);

export const AdminIntegrityFlag = z.object({
  id: z.number().int(),
  user_id: z.string(),
  username: z.string().nullable(),
  kind: IntegrityKind,
  score: z.number(),
  evidence: z.record(z.string(), z.unknown()),
  status: z.enum(['open', 'dismissed', 'actioned']),
  created_at: z.iso.datetime(),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.iso.datetime().nullable(),
  review_note: z.string().nullable(),
});
export type AdminIntegrityFlag = z.infer<typeof AdminIntegrityFlag>;

export const AdminSafetyResponse = z.object({
  moderation: z.array(AdminModerationEntry),
  flags: z.array(AdminIntegrityFlag),
});
export type AdminSafetyResponse = z.infer<typeof AdminSafetyResponse>;

export const AdminIntegrityQuery = z.object({
  status: z.enum(['open', 'dismissed', 'actioned']).default('open'),
});
export const AdminIntegrityResponse = z.object({ flags: z.array(AdminIntegrityFlag) });
export type AdminIntegrityResponse = z.infer<typeof AdminIntegrityResponse>;

/** A moderator's decision on a flag: nothing in it, or acted on (with the action taken on User 360). */
export const AdminIntegrityReview = z.object({
  status: z.enum(['dismissed', 'actioned']),
  note: z.string().trim().min(3).max(500),
});
export type AdminIntegrityReview = z.infer<typeof AdminIntegrityReview>;

// ----- The Daily scheduler (step 2.7f, doc 18 §11) -----

export const AdminDailyQuestion = z.object({
  id: z.string(),
  category: z.string(),
  type: z.string(),
  difficulty: z.number().int(),
  text: z.string(),
  /** In the order written; the app shuffles them per player. */
  options: z.array(z.string()),
  correct_index: z.number().int(),
  fact: z.string().nullable(),
  /** The last Daily it was in, before this one. */
  last_used: z.iso.date().nullable(),
  plays: z.number().int(),
  /** Share of players right, once it has been played. */
  correct_rate: z.number().nullable(),
});
export type AdminDailyQuestion = z.infer<typeof AdminDailyQuestion>;

export const AdminDailyDay = z.object({
  date: z.iso.date(),
  /** Null until it is planned. */
  id: z.number().int().nullable(),
  locked: z.boolean(),
  /** Questions can still be swapped: until 22:00 WAT the day before. */
  editable: z.boolean(),
  players: z.number().int(),
  questions: z.array(AdminDailyQuestion),
});
export type AdminDailyDay = z.infer<typeof AdminDailyDay>;

export const AdminDailyCalendar = z.object({ today: z.iso.date(), days: z.array(AdminDailyDay) });
export type AdminDailyCalendar = z.infer<typeof AdminDailyCalendar>;

export const AdminDailyPlan = z.object({ reason: z.string().trim().min(3).max(300) });
export const AdminDailyPlanResponse = z.object({ planned: z.number().int(), short: z.array(z.iso.date()) });
export type AdminDailyPlanResponse = z.infer<typeof AdminDailyPlanResponse>;

export const AdminDailyCandidatesQuery = z.object({ slot: z.coerce.number().int().min(1).max(7) });
export const AdminDailyCandidates = z.object({
  slot: z.number().int(),
  candidates: z.array(AdminDailyQuestion),
});
export type AdminDailyCandidates = z.infer<typeof AdminDailyCandidates>;

export const AdminDailySwap = z.object({
  slot: z.number().int().min(1).max(7),
  question_id: z.string().min(1).max(60),
  reason: z.string().trim().min(3).max(300),
});
export type AdminDailySwap = z.infer<typeof AdminDailySwap>;

// ----- Compliance: data requests and erasure (step 2.8a, doc 18 §14) -----

export const DsarKind = z.enum(['access', 'erasure', 'rectification', 'portability', 'objection']);
export const AdminDsar = z.object({
  id: z.string(),
  user_id: z.string(),
  username: z.string().nullable(),
  kind: DsarKind,
  status: z.enum(['received', 'in_progress', 'completed', 'rejected']),
  source: z.enum(['app', 'console']),
  note: z.string().nullable(),
  started_by: z.string().nullable(),
  /** Staff member's name, or 'The player' when they did it themselves. */
  handled_by: z.string().nullable(),
  due_at: z.iso.datetime(),
  completed_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
});
export type AdminDsar = z.infer<typeof AdminDsar>;
export const AdminDsarQuery = z.object({ status: z.enum(['open', 'done']).default('open') });
export const AdminDsarResponse = z.object({ requests: z.array(AdminDsar) });
export type AdminDsarResponse = z.infer<typeof AdminDsarResponse>;

/** Support logs a player's request (by email or the help centre); the DPO completes it. */
export const AdminDsarStart = z.object({
  kind: z.enum(['access', 'erasure']),
  note: z.string().trim().min(3).max(500),
});
export type AdminDsarStart = z.infer<typeof AdminDsarStart>;
export const AdminReasoned = z.object({ reason: z.string().trim().min(3).max(300) });

// ----- Commerce: store purchases (step 2.7i, doc 18 §13) -----

/** Money by currency, in the currency's main unit (naira, not kobo). */
export const MoneyByCurrency = z.record(z.string(), z.number());
export type MoneyByCurrency = z.infer<typeof MoneyByCurrency>;

export const CommerceTotals = z.object({
  purchases: z.number().int(),
  refunds: z.number().int(),
  /** Paid, less what was refunded. */
  revenue: MoneyByCurrency,
});
export type CommerceTotals = z.infer<typeof CommerceTotals>;

export const AdminPurchase = z.object({
  id: z.string(),
  user_id: z.string(),
  username: z.string().nullable(),
  store: z.string(),
  product_id: z.string(),
  store_tx_id: z.string(),
  coins: z.number().int().nullable(),
  /** As the store charged it, e.g. '₦1,500'. */
  price: z.string().nullable(),
  status: z.enum(['completed', 'refunded', 'pending']),
  environment: z.enum(['production', 'sandbox']),
  /** The coins reached the player's balance. */
  granted: z.boolean(),
  created_at: z.iso.datetime(),
  refunded_at: z.iso.datetime().nullable(),
});
export type AdminPurchase = z.infer<typeof AdminPurchase>;

/** `GET /admin/commerce`: the totals (real purchases only), each day's, by pack, and a page of purchases. */
export const AdminCommerceResponse = z.object({
  today: CommerceTotals,
  last_7_days: CommerceTotals,
  last_30_days: CommerceTotals,
  /** The last 30 WAT days, oldest first, in naira. */
  days: z.array(z.object({ day: z.iso.date(), purchases: z.number().int(), revenue_ngn: z.number() })),
  by_product: z.array(
    z.object({ product_id: z.string(), purchases: z.number().int(), revenue: MoneyByCurrency }),
  ),
  /** Completed purchases more than 10 minutes old whose coins never arrived. */
  missing_coins: z.number().int(),
  purchases: z.array(AdminPurchase),
  /** For the next page: `before` this time. */
  next: z.iso.datetime().nullable(),
});
export type AdminCommerceResponse = z.infer<typeof AdminCommerceResponse>;

export const AdminCommerceQuery = z.object({
  status: z.enum(['completed', 'refunded']).optional(),
  /** Store test purchases too. */
  sandbox: z.enum(['true', 'false']).optional(),
  before: z.iso.datetime().optional(),
});
export type AdminCommerceQuery = z.infer<typeof AdminCommerceQuery>;

/** A month's purchases as CSV for finance: `GET /admin/commerce/export?month=2026-10`. */
export const AdminCommerceExportQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
