/**
 * Solo rounds: the first-run taste test today, with practice and the Daily to follow.
 * Questions are revealed one at a time with the same serve → answer contract as duels
 * (doc 09 §2.5): the correct answer never reaches the client before the player answers.
 */
import { z } from 'zod';
import { QuestionType } from './content';

export const RoundMode = z.enum(['taste_test']);
export type RoundMode = z.infer<typeof RoundMode>;

export const StartRoundRequest = z.object({ mode: RoundMode });
export type StartRoundRequest = z.infer<typeof StartRoundRequest>;

export const StartRoundResponse = z.object({
  round_id: z.string(),
  mode: RoundMode,
  total: z.number().int().positive(),
  /** Category of each question, in order, so the app can show what's coming. */
  categories: z.array(z.string()),
});
export type StartRoundResponse = z.infer<typeof StartRoundResponse>;

export const ServedQuestion = z.object({
  qid: z.string(),
  seq: z.number().int().positive(),
  total: z.number().int().positive(),
  type: QuestionType,
  category_id: z.string(),
  text: z.string(),
  /** In this player's order; the server maps answers back. */
  options: z.array(z.string()).min(2).max(4),
  media: z.null(),
  time_limit_ms: z.number().int().positive(),
  served_at: z.iso.datetime(),
});
export type ServedQuestion = z.infer<typeof ServedQuestion>;

export const AnswerRequest = z.object({
  /** The option the player tapped, as displayed; null when time ran out. */
  display_index: z.number().int().min(0).max(3).nullable(),
  /** From the question becoming visible to the tap, measured on the device. */
  client_elapsed_ms: z.number().int().min(0).max(600_000).nullable(),
  /** Web only: how long the tab was hidden while the question was showing (integrity signal). */
  tab_hidden_ms: z.number().int().min(0).max(600_000).optional(),
});
export type AnswerRequest = z.infer<typeof AnswerRequest>;

export const ScoreBreakdown = z.object({
  base: z.number().int(),
  speed: z.number().int(),
  streak: z.number().int(),
});

export const AnswerResponse = z.object({
  correct: z.boolean(),
  timed_out: z.boolean(),
  correct_display_index: z.number().int().min(0),
  points: z.number().int().min(0),
  breakdown: ScoreBreakdown,
  /** "Did you know?" line shown after the answer. */
  fact: z.string().nullable(),
  running_score: z.number().int().min(0),
  streak: z.number().int().min(0),
});
export type AnswerResponse = z.infer<typeof AnswerResponse>;

export const RoundResult = z.object({
  round_id: z.string(),
  mode: RoundMode,
  total: z.number().int(),
  answered: z.number().int(),
  correct_count: z.number().int(),
  score: z.number().int(),
  complete: z.boolean(),
  answers: z.array(
    z.object({
      seq: z.number().int(),
      qid: z.string(),
      correct: z.boolean(),
      points: z.number().int(),
    }),
  ),
});
export type RoundResult = z.infer<typeof RoundResult>;
