/**
 * Packs and Solo Practice (GDD §2.6, §6.1, build plan step 2.8f). A pack is a themed set of
 * questions; the six core packs are each a whole category. A player downloads a pack's practice
 * set of up to 50 questions **with** their answers (the one place answers reach a device before
 * the player answers, TRD FR-CON-3), so Practice plays offline. Practice pays XP only.
 */
import { z } from 'zod';

export const PackAccess = z.enum(['free', 'coins', 'pass', 'sponsored']);
export type PackAccess = z.infer<typeof PackAccess>;

export const PackSummary = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  /** A core pack's category, or the category most of a pack's questions are in: its colour. */
  category_id: z.string().nullable(),
  access: PackAccess,
  /** What unlocking a `coins` pack costs. */
  price_coins: z.number().int().nullable(),
  /** Free and sponsored packs are always unlocked; Sabi Pass packs wait for v1.1. */
  unlocked: z.boolean(),
  /** Questions this player can practise, up to the set's 50. */
  questions: z.number().int().min(0),
  ends_at: z.iso.datetime().nullable(),
});
export type PackSummary = z.infer<typeof PackSummary>;

export const PacksResponse = z.object({ packs: z.array(PackSummary) });
export type PacksResponse = z.infer<typeof PacksResponse>;

export const PackUnlockResponse = z.object({
  pack: PackSummary,
  /** The player's coins afterwards. */
  coins: z.number().int().min(0),
});
export type PackUnlockResponse = z.infer<typeof PackUnlockResponse>;

export const PracticeQuestion = z.object({
  qid: z.string(),
  category_id: z.string(),
  type: z.enum(['mcq4', 'true_false']),
  text: z.string(),
  /** In the canonical order: the app shuffles them for each game. */
  options: z.array(z.string()).min(2).max(4),
  correct_index: z.number().int().min(0).max(3),
  fact: z.string().nullable(),
  difficulty: z.number().int().min(1).max(5),
});
export type PracticeQuestion = z.infer<typeof PracticeQuestion>;

/** ISO week, e.g. '2026-W44': a player's set for a pack stays the same all week. */
export const PracticeWeek = z.string().regex(/^\d{4}-W\d{2}$/);

export const PracticeSet = z.object({
  pack_id: z.string(),
  week: PracticeWeek,
  issued_at: z.iso.datetime(),
  /** Each question's time, as in duels. */
  time_limit_ms: z.number().int().positive(),
  questions: z.array(PracticeQuestion).max(50),
});
export type PracticeSet = z.infer<typeof PracticeSet>;

export const PracticeAnswer = z.object({
  qid: z.string().min(1).max(40),
  /** The option picked, in the canonical order; null when time ran out. */
  picked: z.number().int().min(0).max(3).nullable(),
  elapsed_ms: z.number().int().min(0).max(600_000),
});
export type PracticeAnswer = z.infer<typeof PracticeAnswer>;

/** A finished practice game, sent when the device is online (perhaps days later). */
export const PracticeResultRequest = z.object({
  /** Made on the device, so a game sent twice counts once. */
  id: z.uuid(),
  pack_id: z.string().min(1).max(40),
  week: PracticeWeek,
  played_at: z.iso.datetime(),
  /** Up to the game's 10 questions, each once. */
  answers: z
    .array(PracticeAnswer)
    .min(1)
    .max(10)
    .refine((a) => new Set(a.map((x) => x.qid)).size === a.length, { message: 'each question once' }),
  /** Every question answered (or timed out), not left part way. */
  complete: z.boolean(),
});
export type PracticeResultRequest = z.infer<typeof PracticeResultRequest>;

export const PracticeResultResponse = z.object({
  correct: z.number().int().min(0),
  answered: z.number().int().min(0),
  /** XP paid: less than earned once the day's practice XP reaches its cap; 0 for a repeat. */
  xp: z.number().int().min(0),
  capped: z.boolean(),
  level: z.number().int().min(1),
});
export type PracticeResultResponse = z.infer<typeof PracticeResultResponse>;
