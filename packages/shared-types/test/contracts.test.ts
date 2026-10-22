import { describe, expect, it } from 'vitest';
import {
  AnswerRequest,
  AnswerResponse,
  GuestAuthRequest,
  maskPhone,
  normalizeNigerianPhone,
  routes,
  ServedQuestion,
} from '../src';

describe('contracts', () => {
  it('accepts the serve example from the API doc', () => {
    const served = {
      qid: 'q_seed-0024',
      seq: 1,
      total: 3,
      type: 'mcq4',
      category_id: 'nollywood',
      text: 'Who directed The Wedding Party (2016)?',
      options: ['Funke Akindele', 'Kemi Adetiba', 'Kunle Afolayan', 'Niyi Akinmolayan'],
      media: null,
      time_limit_ms: 15000,
      served_at: '2026-10-14T19:02:11.412Z',
    };
    expect(ServedQuestion.parse(served)).toEqual(served);
  });

  it('accepts the answer example from the API doc', () => {
    expect(AnswerRequest.parse({ display_index: 1, client_elapsed_ms: 4210 })).toBeTruthy();
    expect(
      AnswerResponse.parse({
        correct: true,
        timed_out: false,
        correct_display_index: 1,
        points: 172,
        breakdown: { base: 100, speed: 72, streak: 0 },
        fact: 'Niyi Akinmolayan directed the 2017 sequel.',
        running_score: 640,
        streak: 1,
      }).points,
    ).toBe(172);
  });

  it('rejects short or unsafe device ids', () => {
    expect(GuestAuthRequest.safeParse({ device_id: 'short', platform: 'web' }).success).toBe(false);
    expect(GuestAuthRequest.safeParse({ device_id: 'a'.repeat(22) + '/..', platform: 'web' }).success).toBe(
      false,
    );
    expect(
      GuestAuthRequest.safeParse({ device_id: 'Qx7_' + 'a'.repeat(30), platform: 'android' }).success,
    ).toBe(true);
  });

  it('builds escaped paths', () => {
    expect(routes.serve('r_1', 2)).toBe('/v1/rounds/r_1/questions/2/serve');
    expect(routes.round('a/b')).toBe('/v1/rounds/a%2Fb');
  });
});

describe('Nigerian phone numbers', () => {
  it('normalises the usual ways people type them to E.164', () => {
    for (const typed of [
      '0803 123 4567',
      '08031234567',
      '+234 803 123 4567',
      '+234 (0) 803-123-4567',
      '2348031234567',
      '002348031234567',
      '8031234567',
    ]) {
      expect(normalizeNigerianPhone(typed), typed).toBe('+2348031234567');
    }
    expect(normalizeNigerianPhone('0912 345 6789')).toBe('+2349123456789');
    expect(normalizeNigerianPhone('0701 234 5678')).toBe('+2347012345678');
  });

  it('rejects landlines, short numbers and other countries', () => {
    for (const typed of [
      '+44 7700 900123',
      '01 234 5678',
      '0803 123 456',
      '0803123456789',
      '0603 123 4567',
      'abc',
    ]) {
      expect(normalizeNigerianPhone(typed), typed).toBeNull();
    }
  });

  it('masks numbers for logs', () => {
    expect(maskPhone('+2348031234567')).toBe('+234803****567');
  });
});
