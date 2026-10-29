/**
 * The tracking plan as code (doc 13 §2). Every event we record is declared here with:
 *   - sentBy: who may emit it. Business events come from the server so numbers match the
 *     database; clients only report what only they can see (screens, time, taps, device).
 *   - consent: 'core' events (sessions, foreground time, quality, and every service event)
 *     run under legitimate interest; 'behaviour' events (screens, taps, time per screen)
 *     need analytics consent (doc 18 §2.3).
 *   - props: the allowed properties. No PII: see pii.ts and its test.
 *
 * Adding an event means a reviewed change to this file (doc 13, "Tracking plan rules").
 */
import { z } from 'zod';

export type SentBy = 'client' | 'server';
export type ConsentClass = 'core' | 'behaviour';

export interface EventSpec<
  S extends SentBy = SentBy,
  C extends ConsentClass = ConsentClass,
  P extends z.ZodObject = z.ZodObject,
> {
  sentBy: S;
  consent: C;
  props: P;
}

function spec<S extends SentBy, C extends ConsentClass, P extends z.ZodObject>(
  sentBy: S,
  consent: C,
  props: P,
): EventSpec<S, C, P> {
  return { sentBy, consent, props };
}

const count = () => z.number().int().min(0);
const ms = () =>
  z
    .number()
    .int()
    .min(0)
    .max(7 * 86_400_000);
const shortText = (max = 64) => z.string().min(1).max(max);

/** Screens are named 'area.screen' (or just 'area'), so time by mode = time by area. */
export const ScreenName = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/);
const Mode = z.enum(['duel', 'party', 'daily', 'practice', 'taste_test']);
const ShareChannel = z.enum(['whatsapp', 'status', 'x', 'copy', 'web_share', 'other']);
const Store = z.enum(['play', 'app_store', 'paystack']);
const AdFormat = z.enum(['rewarded', 'interstitial', 'banner']);
const OpenedIn = z.enum(['app', 'web_app', 'party_client']);

export const TRACKING_PLAN = {
  // Sessions and time (client, core): time spent comes from app_backgrounded.foreground_ms.
  first_opened: spec('client', 'core', z.object({ source: z.enum(['organic', 'deeplink', 'referrer']) })),
  app_opened: spec(
    'client',
    'core',
    z.object({ cold_start_ms: ms().optional(), source: z.enum(['push', 'deeplink', 'organic']) }),
  ),
  session_started: spec('client', 'core', z.object({ source: z.enum(['launch', 'resume']) })),
  app_foregrounded: spec('client', 'core', z.object({})),
  app_backgrounded: spec(
    'client',
    'core',
    // screen / screen_ms close the last screen view; only sent with behaviour consent.
    z.object({ foreground_ms: ms(), screen: ScreenName.optional(), screen_ms: ms().optional() }),
  ),
  screen_viewed: spec(
    'client',
    'behaviour',
    z.object({ screen: ScreenName, prev_screen: z.union([ScreenName, z.literal('')]), prev_screen_ms: ms() }),
  ),

  // Onboarding and accounts
  taste_test_completed: spec(
    'client',
    'behaviour',
    z.object({ correct_count: count().max(3), score: count(), duration_ms: ms() }),
  ),
  signup_completed: spec(
    'server',
    'core',
    z.object({ method: z.enum(['phone', 'email', 'google', 'apple']), merged_guest: z.boolean() }),
  ),
  otp_sent: spec(
    'server',
    'core',
    z.object({ provider: shortText(40), carrier: shortText(20).optional(), latency_ms: ms().optional() }),
  ),
  otp_verified: spec('server', 'core', z.object({ provider: shortText(40), latency_ms: ms().optional() })),
  otp_failed: spec('server', 'core', z.object({ provider: shortText(40), reason: shortText(60) })),

  // Social
  friend_added: spec(
    'server',
    'core',
    z.object({ source: z.enum(['contacts', 'username', 'opponent', 'link', 'qr']) }),
  ),
  invite_shared: spec(
    'client',
    'behaviour',
    z.object({ channel: ShareChannel, context: z.enum(['duel', 'party', 'daily', 'profile']) }),
  ),
  invite_opened: spec(
    'server',
    'core',
    z.object({
      type: z.enum(['duel', 'party', 'profile', 'daily', 'league']),
      has_app: z.boolean(),
      opened_in: OpenedIn,
    }),
  ),

  // Gameplay (server): every answer, no sampling.
  duel_created: spec(
    'server',
    'core',
    z.object({ opponent_type: z.enum(['friend', 'random', 'link', 'rematch', 'bot']) }),
  ),
  question_served: spec('server', 'core', z.object({ qid: shortText(), mode: Mode, seq: count() })),
  question_answered: spec(
    'server',
    'core',
    z.object({
      qid: shortText(),
      category: shortText(32),
      difficulty: z.number().int().min(1).max(5),
      correct: z.boolean(),
      timed_out: z.boolean(),
      accepted_elapsed_ms: ms(),
      points: count(),
      mode: Mode,
      lifeline: z.enum(['fifty', 'ask_naija', 'skip', 'time']).nullable(),
      tab_hidden_ms: ms().optional(),
    }),
  ),
  duel_round_played: spec(
    'server',
    'core',
    z.object({
      duel_id: shortText(),
      round: z.number().int().min(1).max(4),
      category: shortText(32),
      correct_count: count(),
      points: count(),
      turn_duration_s: count(),
    }),
  ),
  duel_completed: spec(
    'server',
    'core',
    z.object({
      result: z.enum(['win', 'loss', 'tie', 'forfeit']),
      score_self: count(),
      score_opp: count(),
      rating_delta: z.number(),
      duration_total_s: count(),
    }),
  ),
  lifeline_used: spec(
    'server',
    'core',
    z.object({
      type: z.enum(['fifty', 'ask_naija', 'skip', 'time']),
      paid_with: z.enum(['coins', 'ad']),
      mode: Mode,
    }),
  ),
  party_room_created: spec(
    'server',
    'core',
    z.object({
      questions: z.number().int().min(1).max(50),
      timer_s: z.number().int().min(5).max(60),
      packs: z.array(shortText()).max(20),
      family_safe: z.boolean(),
      client: OpenedIn,
    }),
  ),
  party_joined: spec('server', 'core', z.object({ client: OpenedIn, player_count: count() })),
  party_game_completed: spec(
    'server',
    'core',
    z.object({ game_id: shortText(), players: count(), web_guests: count(), rank: count() }),
  ),
  web_guest_install_clicked: spec(
    'client',
    'behaviour',
    z.object({ game_id: shortText(), target: z.enum(['store', 'web_app']) }),
  ),
  pwa_installed: spec('client', 'behaviour', z.object({ prompt: z.enum(['auto', 'manual']) })),
  daily_started: spec('server', 'core', z.object({ daily_id: count() })),
  daily_completed: spec('server', 'core', z.object({ daily_id: count(), score: count(), streak: count() })),
  daily_shared: spec('client', 'behaviour', z.object({ channel: ShareChannel })),
  /** Step 2.8f: a coins pack unlocked for Practice. */
  pack_unlocked: spec('server', 'core', z.object({ pack_id: shortText(), coins: count() })),
  /** Step 2.8f: a practice game, played on the device (perhaps offline) and sent afterwards. */
  practice_completed: spec(
    'server',
    'core',
    z.object({
      pack_id: shortText(),
      answered: count(),
      correct_count: count(),
      complete: z.boolean(),
      xp: count(),
      /** From playing to arriving: long when it was played offline. */
      delay_s: count(),
    }),
  ),
  question_reported: spec(
    'server',
    'core',
    z.object({
      qid: shortText(),
      reason: z.enum(['wrong_answer', 'outdated', 'offensive', 'typo', 'unfair', 'other']),
    }),
  ),

  // Economy and money
  coins_changed: spec(
    'server',
    'core',
    z.object({ delta: z.number().int(), reason: shortText(40), balance_after: count() }),
  ),
  ad_requested: spec(
    'client',
    'behaviour',
    z.object({ format: AdFormat, placement: shortText(40), network: shortText(40).optional() }),
  ),
  ad_shown: spec(
    'client',
    'behaviour',
    z.object({ format: AdFormat, placement: shortText(40), network: shortText(40).optional() }),
  ),
  ad_paid: spec(
    'client',
    'core',
    z.object({
      value_micros: count(),
      currency: z.string().length(3),
      precision: shortText(20),
      format: AdFormat,
    }),
  ),
  ad_reward_granted: spec('server', 'core', z.object({ format: AdFormat, amount: count() })),
  store_viewed: spec('client', 'behaviour', z.object({ tab: shortText(32).optional() })),
  purchase_started: spec('client', 'behaviour', z.object({ sku: shortText(), price_ngn: count() })),
  purchase_failed: spec('client', 'behaviour', z.object({ sku: shortText(), error: shortText(80) })),
  purchase_completed: spec(
    'server',
    'core',
    z.object({ sku: shortText(), store: Store, net_kobo: z.number().int() }),
  ),
  purchase_refunded: spec(
    'server',
    'core',
    // net_kobo is negative: refunds reduce revenue in the rollups.
    z.object({ sku: shortText(), store: Store, net_kobo: z.number().int().max(0) }),
  ),
  pass_started: spec('server', 'core', z.object({ plan: z.enum(['monthly', 'yearly']), store: Store })),
  pass_renewed: spec('server', 'core', z.object({ plan: z.enum(['monthly', 'yearly']), store: Store })),
  pass_cancelled: spec('server', 'core', z.object({ plan: z.enum(['monthly', 'yearly']), store: Store })),

  // Messaging, experiments, settings, quality
  push_sent: spec('server', 'core', z.object({ type: shortText(40), campaign_id: shortText().optional() })),
  push_received: spec('client', 'behaviour', z.object({ type: shortText(40) })),
  push_opened: spec('client', 'behaviour', z.object({ type: shortText(40) })),
  experiment_exposed: spec(
    'client',
    'behaviour',
    z.object({ experiment: shortText(), variant: shortText(40) }),
  ),
  consent_changed: spec('server', 'core', z.object({ purpose: shortText(40), granted: z.boolean() })),
  data_saver_toggled: spec('client', 'behaviour', z.object({ on: z.boolean() })),
  connection_lost: spec('client', 'core', z.object({ mode: z.union([Mode, z.literal('menu')]) })),
  connection_restored: spec(
    'client',
    'core',
    z.object({ mode: z.union([Mode, z.literal('menu')]), gap_ms: ms() }),
  ),
  web_vitals: spec(
    'client',
    'core',
    z.object({
      lcp_ms: ms().optional(),
      inp_ms: ms().optional(),
      cls: z.number().min(0).max(10).optional(),
    }),
  ),
} as const;

export type TrackingPlan = typeof TRACKING_PLAN;
export type EventName = keyof TrackingPlan;
export type EventProps<E extends EventName> = z.input<TrackingPlan[E]['props']>;

export type ClientEventName = {
  [K in EventName]: TrackingPlan[K]['sentBy'] extends 'client' ? K : never;
}[EventName];

export type ServerEventName = {
  [K in EventName]: TrackingPlan[K]['sentBy'] extends 'server' ? K : never;
}[EventName];

export function isEventName(name: string): name is EventName {
  return Object.prototype.hasOwnProperty.call(TRACKING_PLAN, name);
}
