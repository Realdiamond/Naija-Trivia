/**
 * PII guard for the tracking plan (TRD FR-ANA-1). Property names are split on '_' and no
 * part may be one of these words, so `phone_number`, `email`, `question_text` or
 * `nickname` can never become an analytics property.
 */
import { z } from 'zod';
import { TRACKING_PLAN } from './plan';

export const PII_WORDS: readonly string[] = [
  'phone',
  'msisdn',
  'email',
  'name',
  'username',
  'nickname',
  'password',
  'otp',
  'pin',
  'address',
  'ip',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'location',
  'contact',
  'contacts',
  'text',
  'message',
  'note',
  'comment',
  'dob',
  'birthday',
  'birthdate',
];

/** Every property (including nested ones) whose name looks like PII, as 'event.prop'. */
export function piiViolations(plan: Record<string, { props: z.ZodType }> = TRACKING_PLAN): string[] {
  const found: string[] = [];
  for (const [event, { props }] of Object.entries(plan)) {
    for (const key of propertyNames(props)) {
      if (key.split(/[_.]/).some((part) => PII_WORDS.includes(part.toLowerCase())))
        found.push(`${event}.${key}`);
    }
  }
  return found;
}

function propertyNames(schema: z.ZodType, prefix = ''): string[] {
  const inner = unwrap(schema);
  if (inner instanceof z.ZodObject) {
    return Object.entries(inner.shape as Record<string, z.ZodType>).flatMap(([key, child]) => [
      prefix + key,
      ...propertyNames(child, `${prefix}${key}.`),
    ]);
  }
  if (inner instanceof z.ZodArray) return propertyNames(inner.element as z.ZodType, prefix);
  return [];
}

function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  while (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
    current = current.unwrap() as z.ZodType;
  }
  return current;
}
