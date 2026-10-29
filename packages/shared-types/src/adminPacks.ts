/**
 * Packs in the console's Content module (doc 18 §12, build plan step 2.8f): everyone with
 * `content.view` sees them; editors, admins and owners (`content.publish`) make and change them
 * and choose their questions. A pack with a category also holds every live question in it.
 */
import { z } from 'zod';
import { CategoryId } from './content';
import { PackAccess } from './packs';

const Slug = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, numbers and dashes');

const AdminPackFields = z.object({
  title: z.string().trim().min(2).max(60),
  slug: Slug,
  description: z.string().trim().max(200).nullable(),
  access: PackAccess,
  price_coins: z.number().int().min(1).max(5000).nullable(),
  category_id: CategoryId.nullable(),
  starts_at: z.iso.datetime().nullable(),
  ends_at: z.iso.datetime().nullable(),
  active: z.boolean(),
});

export const AdminPackInput = AdminPackFields.refine(
  (p) => (p.access === 'coins') === (p.price_coins !== null),
  { message: 'A coins pack needs a price, and only a coins pack has one', path: ['price_coins'] },
).refine((p) => !p.starts_at || !p.ends_at || p.ends_at > p.starts_at, {
  message: 'It must end after it starts',
  path: ['ends_at'],
});
export type AdminPackInput = z.infer<typeof AdminPackInput>;

export const AdminPack = AdminPackFields.extend({
  id: z.string(),
  /** Questions chosen for it by hand. */
  chosen: z.number().int(),
  /** Questions players can get from it now: live, in an active category, not expired. */
  live: z.number().int(),
  updated_at: z.iso.datetime(),
});
export type AdminPack = z.infer<typeof AdminPack>;

export const AdminPacksResponse = z.object({ packs: z.array(AdminPack) });
export type AdminPacksResponse = z.infer<typeof AdminPacksResponse>;

export const AdminPackQuestion = z.object({
  id: z.string(),
  external_ref: z.string().nullable(),
  text: z.string(),
  category_id: z.string(),
  status: z.string(),
});
export type AdminPackQuestion = z.infer<typeof AdminPackQuestion>;

export const AdminPackDetail = z.object({
  pack: AdminPack,
  /** The questions chosen by hand, newest first. */
  questions: z.array(AdminPackQuestion),
});
export type AdminPackDetail = z.infer<typeof AdminPackDetail>;

/** Question ids or references (e.g. SEED-0001), as pasted from the question list or a sheet. */
export const AdminPackQuestionsAdd = z.object({
  refs: z.array(z.string().trim().min(1).max(40)).min(1).max(300),
});
export type AdminPackQuestionsAdd = z.infer<typeof AdminPackQuestionsAdd>;

export const AdminPackQuestionsAdded = z.object({
  added: z.number().int(),
  /** In the pack already. */
  already: z.number().int(),
  /** Not a question we know. */
  unknown: z.array(z.string()),
});
export type AdminPackQuestionsAdded = z.infer<typeof AdminPackQuestionsAdded>;
