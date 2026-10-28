import { describe, expect, it } from 'vitest';
import { checkQuestion, normaliseQuestionText, type QuestionDraft } from '../src/questionRules';

const good: QuestionDraft = {
  type: 'mcq4',
  text: 'Who directed The Wedding Party (2016)?',
  options: ['Kemi Adetiba', 'Funke Akindele', 'Kunle Afolayan', 'Niyi Akinmolayan'],
  correctIndex: 0,
  numericAnswer: null,
  fact: 'Niyi Akinmolayan directed the 2017 sequel.',
  difficulty: 2,
  regionTag: 'SW',
  validUntil: null,
  sourceUrl: 'https://en.wikipedia.org/wiki/The_Wedding_Party_(2016_film)',
};

describe('the Question Bible checks', () => {
  it('passes a well-formed question', () => {
    expect(checkQuestion(good, { forReview: true })).toEqual({ errors: [], warnings: [] });
  });

  it('applies the length limits and the option rules', () => {
    const { errors } = checkQuestion({
      ...good,
      text: `${'x'.repeat(121)}?`,
      options: ['Same', 'same', 'An option far longer than thirty characters', ''],
      correctIndex: 5,
      fact: 'f'.repeat(161),
      difficulty: 6,
    });
    expect(errors).toEqual([
      'The question is 122 characters; the limit is 120.',
      'Difficulty must be 1 to 5.',
      'A four-option question needs 4 options.',
      'Two options are the same.',
      '"An option far longer than thirty characters" is 43 characters; options are at most 30.',
      'Mark which option is right.',
      'The fact is 161 characters; the limit is 160.',
    ]);
  });

  it('needs a source only for review, and a date for "As of" questions', () => {
    const draft = { ...good, sourceUrl: null, text: 'As of October 2026, who is the Super Eagles coach?' };
    expect(checkQuestion(draft).errors).toEqual(['An "As of …" question needs a "valid until" date.']);
    expect(checkQuestion({ ...draft, validUntil: '2027-10-31' }, { forReview: true }).errors).toEqual([
      'Add the source link that confirms the fact.',
    ]);
    expect(checkQuestion({ ...good, sourceUrl: 'not a link' }).errors).toEqual([
      'The source must be a web link.',
    ]);
  });

  it('checks closest-number and true/false questions by their own rules', () => {
    const closest = { ...good, type: 'closest_number' as const, options: [], correctIndex: null };
    expect(checkQuestion({ ...closest, numericAnswer: 1960 }).errors).toEqual([]);
    expect(checkQuestion(closest).errors).toEqual([
      'A closest-number question needs the number as its answer.',
    ]);
    expect(
      checkQuestion({ ...good, type: 'true_false', options: ['True', 'False'], correctIndex: 1 }).errors,
    ).toEqual([]);
    expect(checkQuestion({ ...good, text: 'Who directed The Wedding Party' }).warnings).toHaveLength(1);
  });

  it('normalises text for duplicate checks', () => {
    expect(normaliseQuestionText('As of October 2026, Who is the  Super Eagles coach?')).toBe(
      'who is the super eagles coach',
    );
  });
});
