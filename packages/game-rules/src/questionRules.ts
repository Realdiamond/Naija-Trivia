/**
 * The Question Bible's format rules (doc 04 §2.3), the same ones the question bank's checker
 * applies (docs/content/question-bank/questionbank.py). The admin console's editor and its CSV
 * import run them; errors block review, warnings are shown.
 */

export const QUESTION_LIMITS = { text: 120, option: 30, fact: 160 } as const;
export const REGION_TAGS = ['ALL', 'SW', 'SE', 'SS', 'N', 'NC'] as const;

export interface QuestionDraft {
  type: 'mcq4' | 'true_false' | 'closest_number';
  text: string;
  options: readonly string[];
  /** Index of the right option; null for closest-number questions. */
  correctIndex: number | null;
  numericAnswer: number | null;
  fact: string | null;
  difficulty: number;
  regionTag: string | null;
  /** 'YYYY-MM-DD' or null. */
  validUntil: string | null;
  sourceUrl: string | null;
}

export interface QuestionProblems {
  /** Must be fixed before the question can go for review. */
  errors: string[];
  /** Worth a look; never blocking. */
  warnings: string[];
}

/**
 * `forReview` adds what a fact-checker needs: a source link for every question. A draft can be
 * saved without one.
 */
export function checkQuestion(q: QuestionDraft, options: { forReview?: boolean } = {}): QuestionProblems {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = q.text.trim();

  if (text.length === 0) errors.push('The question is empty.');
  if (text.length > QUESTION_LIMITS.text)
    errors.push(`The question is ${text.length} characters; the limit is ${QUESTION_LIMITS.text}.`);
  if (text.length > 0 && !/[?…]$/.test(text))
    warnings.push('A question usually ends with ? (or … for finish-the-line).');
  if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 5)
    errors.push('Difficulty must be 1 to 5.');

  const opts = q.options.map((o) => o.trim());
  if (q.type === 'closest_number') {
    if (opts.some((o) => o.length > 0)) errors.push('A closest-number question has no options.');
    if (q.numericAnswer === null || !Number.isFinite(q.numericAnswer))
      errors.push('A closest-number question needs the number as its answer.');
  } else {
    const wanted = q.type === 'mcq4' ? 4 : 2;
    if (opts.length !== wanted || opts.some((o) => o.length === 0))
      errors.push(`A ${q.type === 'mcq4' ? 'four-option' : 'true/false'} question needs ${wanted} options.`);
    if (new Set(opts.map((o) => o.toLowerCase())).size < opts.length)
      errors.push('Two options are the same.');
    for (const o of opts) {
      if (o.length > QUESTION_LIMITS.option)
        errors.push(`"${o}" is ${o.length} characters; options are at most ${QUESTION_LIMITS.option}.`);
    }
    if (q.correctIndex === null || q.correctIndex < 0 || q.correctIndex >= opts.length)
      errors.push('Mark which option is right.');
  }

  const fact = q.fact?.trim() ?? '';
  if (fact.length > QUESTION_LIMITS.fact)
    errors.push(`The fact is ${fact.length} characters; the limit is ${QUESTION_LIMITS.fact}.`);
  if (q.regionTag !== null && !(REGION_TAGS as readonly string[]).includes(q.regionTag))
    errors.push(`The region must be one of ${REGION_TAGS.join(', ')}.`);
  if (q.validUntil !== null && !/^\d{4}-\d{2}-\d{2}$/.test(q.validUntil))
    errors.push('"Valid until" must be a date like 2027-10-31.');
  if (/^as of\b/i.test(text) && q.validUntil === null)
    errors.push('An "As of …" question needs a "valid until" date.');

  const source = q.sourceUrl?.trim() ?? '';
  if (source.length > 0 && !/^https?:\/\/\S+$/.test(source)) errors.push('The source must be a web link.');
  if (options.forReview && source.length === 0) errors.push('Add the source link that confirms the fact.');
  return { errors, warnings };
}

/** For duplicate checks: lower case, letters, digits and spaces only, without an "As of …," lead-in. */
export function normaliseQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/^as of [^,]*,\s*/, '')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
