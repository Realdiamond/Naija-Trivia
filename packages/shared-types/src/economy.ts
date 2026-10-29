/** Coins and the wallet (GDD §5.1, API §2.8). Gems come with the shop's premium items (v1.1). */
import { z } from 'zod';

export const Currency = z.enum(['coins', 'gems']);
export type Currency = z.infer<typeof Currency>;

/** Why coins moved. The app turns each into words in the wallet's history. */
export const LedgerReason = z.enum([
  'duel_win',
  'duel_loss',
  'duel_draw',
  'daily',
  'level_up',
  /** A guest's coins, moved into the account they signed in to. */
  'merge',
  'lifeline',
  'rewarded_ad',
  'iap',
  'refund',
  'admin_grant',
]);
export type LedgerReason = z.infer<typeof LedgerReason>;

export const Wallet = z.object({
  coins: z.number().int().min(0),
  gems: z.number().int().min(0),
});
export type Wallet = z.infer<typeof Wallet>;

export const WalletEntry = z.object({
  id: z.string(),
  /** Positive when earned, negative when spent. */
  amount: z.number().int(),
  currency: Currency,
  reason: LedgerReason,
  /** What it was for: `duel` (a duel id), `daily` (its number), `level` (the level reached). */
  ref_type: z.string().nullable(),
  ref_id: z.string().nullable(),
  created_at: z.iso.datetime(),
});
export type WalletEntry = z.infer<typeof WalletEntry>;

export const WalletHistoryQuery = z.object({
  /** The `next` of the page before. */
  before: z.string().regex(/^\d+$/).optional(),
});

export const WalletHistory = z.object({
  items: z.array(WalletEntry),
  next: z.string().nullable(),
});
export type WalletHistory = z.infer<typeof WalletHistory>;

/** Rewarded ads (step 2.4c): what one pays, and how many more will pay today. */
export const RewardedAdStatus = z.object({
  coins: z.number().int().min(0),
  left_today: z.number().int().min(0),
});
export type RewardedAdStatus = z.infer<typeof RewardedAdStatus>;

/** A coin pack (doc 11 §3, step 2.4d). The store shows the price the player actually pays. */
export const CoinPackView = z.object({
  sku: z.string(),
  coins: z.number().int().positive(),
  bonus_pct: z.number().int().min(0),
  /** The Naira list price, for when the store's own price isn't known. */
  price_ngn: z.number().int().positive(),
});
export type CoinPackView = z.infer<typeof CoinPackView>;

export const ShopResponse = z.object({ packs: z.array(CoinPackView) });
export type ShopResponse = z.infer<typeof ShopResponse>;

/** The payment journey, for the staff alerts (step 2.9b): the shop opened, a buy tapped. */
export const ShopEventRequest = z.object({
  kind: z.enum(['opened', 'started']),
  sku: z.string().max(40).optional(),
});
export type ShopEventRequest = z.infer<typeof ShopEventRequest>;

/** What a finished game paid one player. */
export const GameReward = z.object({
  coins: z.number().int().min(0),
  xp: z.number().int().min(0),
});
export type GameReward = z.infer<typeof GameReward>;
