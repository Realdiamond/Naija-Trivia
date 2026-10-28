import { z } from 'zod';

export const CategoryId = z.enum(['slang', 'nollywood', 'music', 'food', 'sport', 'mixed']);
export type CategoryId = z.infer<typeof CategoryId>;

export const Category = z.object({
  id: z.string(),
  name_en: z.string(),
  name_pcm: z.string().nullable(),
  emoji: z.string().nullable(),
  color_hex: z.string().nullable(),
});
export type Category = z.infer<typeof Category>;

export const CategoriesResponse = z.object({ categories: z.array(Category) });
export type CategoriesResponse = z.infer<typeof CategoriesResponse>;

export const QuestionType = z.enum(['mcq4', 'true_false', 'image_mcq', 'audio_mcq', 'closest_number']);
export type QuestionType = z.infer<typeof QuestionType>;
