import { describe, expect, it } from 'vitest';
import { ScreenName } from '@whosabi/analytics';
import { screenName } from './screens';

describe('screenName', () => {
  it('turns routes into tracking-plan screen names', () => {
    expect(screenName([])).toBe('index');
    expect(screenName(['welcome'])).toBe('welcome');
    expect(screenName(['profile-setup'])).toBe('profile_setup');
    expect(screenName(['taste-result'])).toBe('taste_result');
    expect(screenName(['(tabs)', 'home'])).toBe('home');
    expect(screenName(['duel', '[id]', 'result'])).toBe('duel.id');
    expect(screenName(['d', '[token]'])).toBe('d.token');
  });

  it('always gives a name the ingest service accepts', () => {
    for (const segments of [['404'], ['+not-found'], ['[...rest]'], ['A-B', 'c d']]) {
      expect(ScreenName.safeParse(screenName(segments)).success, segments.join('/')).toBe(true);
    }
  });
});
