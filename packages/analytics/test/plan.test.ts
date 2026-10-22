import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { piiViolations, TRACKING_PLAN } from '../src';

describe('tracking plan', () => {
  it('has no property that looks like personal data', () => {
    expect(piiViolations()).toEqual([]);
  });

  it('catches PII-looking names, including nested ones', () => {
    const plan = {
      bad_event: {
        props: z.object({ phone_number: z.string(), meta: z.object({ nickname: z.string().optional() }) }),
      },
      fine_event: { props: z.object({ screen: z.string(), points: z.number() }) },
    };
    expect(piiViolations(plan)).toEqual(['bad_event.phone_number', 'bad_event.meta.nickname']);
  });

  it('names every event object_action and declares who sends it', () => {
    for (const [name, spec] of Object.entries(TRACKING_PLAN)) {
      expect(name).toMatch(/^[a-z]+(_[a-z0-9]+)+$/);
      expect(['client', 'server']).toContain(spec.sentBy);
      expect(['core', 'behaviour']).toContain(spec.consent);
    }
  });

  it('keeps business events on the server so numbers match the database', () => {
    for (const name of [
      'question_answered',
      'duel_completed',
      'coins_changed',
      'purchase_completed',
      'ad_reward_granted',
    ] as const) {
      expect(TRACKING_PLAN[name].sentBy).toBe('server');
    }
  });
});
