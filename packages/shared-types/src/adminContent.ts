/**
 * The admin console's Content module (doc 18 §12, doc 04 §3, TRD §4.2): questions through their
 * workflow (draft → in review → approved → live, then suspended or retired), the CSV import and
 * the queue of player reports. Served under /admin like the rest of the admin API.
 */
import { z } from 'zod';
import { CategoryId } from './content';

export const QuestionStatus = z.enum(['draft', 'in_review', 'approved', 'live', 'suspended', 'retired']);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

/** The types the editor writes; picture and audio questions come with media uploads. */
export const EditableQuestionType = z.enum(['mcq4', 'true_false', 'closest_number']);

export const RegionTag = z.enum(['ALL', 'SW', 'SE', 'SS', 'N', 'NC']);

export const AdminQuestionInput = z
  .object({
    category_id: CategoryId,
    subcategory: z.string().trim().max(40).nullable().default(null),
    type: EditableQuestionType,
    text: z.string().trim().min(1).max(160),
    /** Canonical order; the game shuffles them for each player. Empty for closest-number. */
    options: z.array(z.string().trim().max(60)).max(4),
    correct_index: z.number().int().min(0).max(3).nullable(),
    numeric_answer: z.number().finite().nullable().default(null),
    fact: z.string().trim().max(200).nullable().default(null),
    difficulty: z.number().int().min(1).max(5),
    family_safe: z.boolean().default(true),
    region_tag: RegionTag.nullable().default(null),
    valid_until: z.iso.date().nullable().default(null),
    source_url: z.string().trim().max(500).nullable().default(null),
  })
  .strict();
export type AdminQuestionInput = z.infer<typeof AdminQuestionInput>;

export const QuestionAction = z.enum([
  /** Writer: draft → in review. */
  'submit',
  /** Fact-checker (not the writer): in review → approved. */
  'approve',
  /** Fact-checker: in review → draft, with a note saying what to fix. */
  'send_back',
  /** Editor: approved → live. */
  'publish',
  /** Editor: live → suspended (out of rotation). */
  'suspend',
  /** Editor: suspended → live. */
  'restore',
  /** Editor: out of the game for good. */
  'retire',
  /** Editor: retired → draft, to work on it again. */
  'reopen',
]);
export type QuestionAction = z.infer<typeof QuestionAction>;

export const AdminQuestionActionRequest = z
  .object({ action: QuestionAction, note: z.string().trim().max(500).optional() })
  .strict();

export const AdminBulkPublishRequest = z
  .object({ ids: z.array(z.string().max(60)).min(1).max(200) })
  .strict();
export const AdminBulkPublishResponse = z.object({
  published: z.number().int(),
  /** Ids that were not approved, or fail a check. */
  skipped: z.array(z.string()),
});
export type AdminBulkPublishResponse = z.infer<typeof AdminBulkPublishResponse>;

export const AdminQuestionListQuery = z.object({
  status: QuestionStatus.optional(),
  category: CategoryId.optional(),
  /** Words in the question, or its id (q_…, SPT-0007). */
  q: z.string().trim().max(100).optional(),
  /** Only questions with open player reports. */
  reported: z.coerce.boolean().optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const AdminQuestionRow = z.object({
  id: z.string(),
  external_ref: z.string().nullable(),
  text: z.string(),
  category_id: z.string(),
  type: z.string(),
  difficulty: z.number().int(),
  status: QuestionStatus,
  version: z.number().int(),
  author: z.string().nullable(),
  plays: z.number().int(),
  /** Share answered right, 0–1; null before anyone has played it. */
  correct_rate: z.number().nullable(),
  open_reports: z.number().int(),
  updated_at: z.iso.datetime(),
});
export type AdminQuestionRow = z.infer<typeof AdminQuestionRow>;

export const AdminQuestionListResponse = z.object({
  questions: z.array(AdminQuestionRow),
  next_cursor: z.string().nullable(),
  /** How many questions are in each status (within the category filter). */
  counts: z.record(QuestionStatus, z.number().int()),
});
export type AdminQuestionListResponse = z.infer<typeof AdminQuestionListResponse>;

export const AdminQuestionHistoryItem = z.object({
  action: z.string(),
  actor: z.string(),
  note: z.string().nullable(),
  version: z.number().int(),
  at: z.iso.datetime(),
});

export const AdminQuestion = AdminQuestionInput.extend({
  id: z.string(),
  external_ref: z.string().nullable(),
  status: QuestionStatus,
  version: z.number().int(),
  author: z.string().nullable(),
  author_id: z.string().nullable(),
  reviewed_by: z.string().nullable(),
  d_rating: z.number(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  /** Live performance (doc 04 §3): from every mode, all platforms. */
  stats: z.object({
    plays: z.number().int(),
    correct: z.number().int(),
    avg_elapsed_ms: z.number().int().nullable(),
    /** Picks per option, in canonical order. */
    option_counts: z.array(z.number().int()),
  }),
  open_reports: z.number().int(),
  /** The Question Bible checks: errors block review. */
  checks: z.object({ errors: z.array(z.string()), warnings: z.array(z.string()) }),
  /** Questions that read almost the same (trigram similarity above 0.7). */
  similar: z.array(
    z.object({ id: z.string(), text: z.string(), status: QuestionStatus, similarity: z.number() }),
  ),
  /** What this staff member may do with it now. */
  allowed_actions: z.array(QuestionAction),
  can_edit: z.boolean(),
  history: z.array(AdminQuestionHistoryItem),
});
export type AdminQuestion = z.infer<typeof AdminQuestion>;

// ----- CSV import -----

/** Up to about 2,000 rows: one category file from the question bank fits. */
export const AdminImportRequest = z
  .object({
    csv: z.string().min(1).max(2_000_000),
    /** Check only: nothing is saved. */
    dry_run: z.boolean().default(true),
    /** Editors: rows already marked approved in the question bank go straight live. */
    publish_approved: z.boolean().default(false),
  })
  .strict();

export const AdminImportProblem = z.object({ line: z.number().int(), ref: z.string(), message: z.string() });

export const AdminImportResponse = z.object({
  dry_run: z.boolean(),
  rows: z.number().int(),
  /** New questions, by the status they get. */
  created: z.record(QuestionStatus, z.number().int()),
  /** Already in the game (same id), marked rejected in the question bank, or a copy of a live question. */
  skipped: z.number().int(),
  errors: z.array(AdminImportProblem),
  warnings: z.array(AdminImportProblem),
});
export type AdminImportResponse = z.infer<typeof AdminImportResponse>;

// ----- Player reports -----

export const ReportReason = z.enum(['wrong_answer', 'outdated', 'offensive', 'typo', 'unfair']);
export type ReportReason = z.infer<typeof ReportReason>;

/** PRD US-9: two taps, an optional note. */
export const QuestionReportRequest = z
  .object({ reason: ReportReason, note: z.string().trim().max(300).optional() })
  .strict();
export type QuestionReportRequest = z.infer<typeof QuestionReportRequest>;

export const AdminReportGroup = z.object({
  question: z.object({
    id: z.string(),
    external_ref: z.string().nullable(),
    text: z.string(),
    category_id: z.string(),
    status: QuestionStatus,
  }),
  open: z.number().int(),
  reasons: z.record(z.string(), z.number().int()),
  /** The latest notes, newest first. */
  notes: z.array(z.string()),
  plays: z.number().int(),
  auto_suspended: z.boolean(),
  first_at: z.iso.datetime(),
  last_at: z.iso.datetime(),
});
export type AdminReportGroup = z.infer<typeof AdminReportGroup>;

export const AdminReportsResponse = z.object({ groups: z.array(AdminReportGroup) });
export type AdminReportsResponse = z.infer<typeof AdminReportsResponse>;

export const AdminResolveReports = z
  .object({
    /**
     * fixed: the question was corrected (it goes back live if it was suspended);
     * rejected: nothing wrong (back live too); retired: out of the game.
     */
    resolution: z.enum(['fixed', 'rejected', 'retired']),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
