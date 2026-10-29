/**
 * Async 1v1 duels (GDD §2.1, TRD §4.3 and §5.2, doc 09 §2.5).
 *
 * Every view is from one player's side ("you" and "opponent"): a player only sees the
 * questions, answers and opponent's points of rounds they have finished themselves, so a
 * duel can never be looked up ahead of playing it.
 */
import { z } from 'zod';
import { GameReward } from './economy';
import { AnswerResponse } from './rounds';

export const DuelState = z.enum([
  'created',
  'wait_b_r1r2',
  'wait_a_r2r3',
  'wait_b_r3',
  'tiebreak',
  'complete',
  'forfeit',
  'declined',
  'cancelled',
]);
export type DuelState = z.infer<typeof DuelState>;

export const DuelSource = z.enum(['friend', 'random', 'rematch', 'link', 'bot']);
export type DuelSource = z.infer<typeof DuelSource>;

/**
 * A friend or past opponent by id, an invite link for anyone, or a random opponent: a player
 * near your rating, or the Sabi Bot when nobody is free within a minute (TRD FR-DUEL-6).
 */
export const CreateDuelRequest = z.object({
  opponent: z.union([
    z.object({ user_id: z.string().min(3).max(40) }).strict(),
    z.object({ link: z.literal(true) }).strict(),
    z.object({ random: z.literal(true) }).strict(),
  ]),
});
export type CreateDuelRequest = z.infer<typeof CreateDuelRequest>;

export const DuelPlayer = z.object({
  id: z.string(),
  username: z.string().nullable(),
  level: z.number().int(),
});
export type DuelPlayer = z.infer<typeof DuelPlayer>;

/** What the player should do next; null once the duel is over. */
export const DuelNextAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('pick_category'),
    round: z.number().int().min(1).max(3),
    offered: z.array(z.string()).length(3),
  }),
  z.object({
    action: z.literal('play'),
    round: z.number().int().min(1).max(3),
    seq: z.number().int().min(1),
  }),
  z.object({ action: z.literal('tiebreak') }),
  z.object({ action: z.literal('wait') }),
]);
export type DuelNextAction = z.infer<typeof DuelNextAction>;

export const RoundProgress = z.object({
  answered: z.number().int().min(0),
  correct: z.number().int().min(0),
  points: z.number().int().min(0),
});
export type RoundProgress = z.infer<typeof RoundProgress>;

/** A question from a round the player has finished: post-match review with the "Did you know?" fact. */
export const ReviewQuestion = z.object({
  seq: z.number().int(),
  qid: z.string(),
  text: z.string(),
  /** In this player's order. */
  options: z.array(z.string()),
  correct_display_index: z.number().int().min(0),
  your_display_index: z.number().int().min(0).nullable(),
  your_points: z.number().int().min(0),
  /** Null until the opponent has answered it. */
  opponent_correct: z.boolean().nullable(),
  fact: z.string().nullable(),
});
export type ReviewQuestion = z.infer<typeof ReviewQuestion>;

export const DuelRoundView = z.object({
  round: z.number().int().min(1).max(3),
  category_id: z.string().nullable(),
  picked_by: z.enum(['you', 'opponent']).nullable(),
  you: RoundProgress,
  /** Null until you have finished this round. */
  opponent: RoundProgress.nullable(),
  /** Null until you have finished this round. */
  questions: z.array(ReviewQuestion).nullable(),
});
export type DuelRoundView = z.infer<typeof DuelRoundView>;

export const TiebreakView = z.object({
  text: z.string(),
  your_guess: z.number().nullable(),
  answered: z.boolean(),
  opponent_answered: z.boolean(),
  /** Shown once you have answered. */
  answer: z.number().nullable(),
  /** Shown once both have answered. */
  opponent_guess: z.number().nullable(),
});
export type TiebreakView = z.infer<typeof TiebreakView>;

export const DuelResult = z.enum(['win', 'loss', 'draw']);
export type DuelResult = z.infer<typeof DuelResult>;

export const DuelSummary = z.object({
  id: z.string(),
  state: DuelState,
  source: DuelSource,
  you: z.enum(['a', 'b']),
  /** Null while a link invite is waiting to be accepted. */
  opponent: DuelPlayer.nullable(),
  your_turn: z.boolean(),
  turn_deadline: z.iso.datetime().nullable(),
  /** The opponent's score only counts rounds you have finished. */
  score: z.object({ you: z.number().int().min(0), opponent: z.number().int().min(0) }),
  /** Set when the duel finished with a result (not for declined or cancelled duels). */
  result: DuelResult.nullable(),
  rating_delta: z.number().nullable(),
  /** The coins and XP the duel paid you, once it finished with a result (step 2.4a). */
  reward: GameReward.nullable(),
  created_at: z.iso.datetime(),
  completed_at: z.iso.datetime().nullable(),
});
export type DuelSummary = z.infer<typeof DuelSummary>;

export const DuelView = DuelSummary.extend({
  /** The link to share while nobody has accepted the invite (challenger only). */
  invite_url: z.string().nullable(),
  next: DuelNextAction.nullable(),
  rounds: z.array(DuelRoundView).length(3),
  tiebreak: TiebreakView.nullable(),
});
export type DuelView = z.infer<typeof DuelView>;

export const CreateDuelResponse = z.object({
  duel: DuelView,
  invite_url: z.string().nullable(),
});
export type CreateDuelResponse = z.infer<typeof CreateDuelResponse>;

export const ListDuelsQuery = z.object({
  state: z.enum(['active', 'done']).default('active'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});
export type ListDuelsQuery = z.infer<typeof ListDuelsQuery>;

export const ListDuelsResponse = z.object({
  duels: z.array(DuelSummary),
  /** Pass back as `cursor` for the next page; null on the last page. */
  next_cursor: z.string().nullable(),
});
export type ListDuelsResponse = z.infer<typeof ListDuelsResponse>;

export const PickCategoryRequest = z.object({ category_id: z.string().min(1).max(32) });
export type PickCategoryRequest = z.infer<typeof PickCategoryRequest>;

/** The answer to a round question, plus what to do next so the app needs no extra request. */
export const DuelAnswerResponse = AnswerResponse.extend({
  next: DuelNextAction.nullable(),
});
export type DuelAnswerResponse = z.infer<typeof DuelAnswerResponse>;

/** Round 4 is the tie-break: one closest-number question, answered with a number. */
export const TiebreakAnswerRequest = z.object({
  /** Null when time ran out. */
  guess: z.number().min(-1e12).max(1e12).nullable(),
  client_elapsed_ms: z.number().int().min(0).max(600_000).nullable(),
});
export type TiebreakAnswerRequest = z.infer<typeof TiebreakAnswerRequest>;

export const TiebreakAnswerResponse = z.object({
  guess: z.number().nullable(),
  timed_out: z.boolean(),
  answer: z.number(),
  fact: z.string().nullable(),
  /** True once both players have answered; `result` is then set. */
  decided: z.boolean(),
  result: DuelResult.nullable(),
});
export type TiebreakAnswerResponse = z.infer<typeof TiebreakAnswerResponse>;

/** Public preview behind whosabi.ng/d/{token} (no sign-in needed). */
export const InvitePreview = z.object({
  challenger: DuelPlayer,
  status: z.enum(['open', 'taken', 'closed']),
  expires_at: z.iso.datetime().nullable(),
});
export type InvitePreview = z.infer<typeof InvitePreview>;
