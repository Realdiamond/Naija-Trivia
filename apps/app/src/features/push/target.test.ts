import { describe, expect, it } from 'vitest';
import { pushTarget } from './target';

describe('pushTarget', () => {
  it("opens the push's own screen", () => {
    expect(pushTarget({ type: 'your_turn', url: '/duel/d_01ABC', duel_id: 'd_01ABC' })).toEqual({
      url: '/duel/d_01ABC',
      type: 'your_turn',
    });
    expect(pushTarget({ type: 'daily_live', url: '/daily/play' }).url).toBe('/daily/play');
    expect(pushTarget({ type: 'friend_joined', url: '/friends' }).url).toBe('/friends');
  });

  it('reads the data wherever the phone put it', () => {
    expect(pushTarget({}, { type: 'duel_result', url: '/duel/d_9' })).toEqual({
      url: '/duel/d_9',
      type: 'duel_result',
    });
    expect(pushTarget(null, undefined)).toEqual({ url: '/home', type: 'unknown' });
  });

  it('opens Home for anything that is not a push screen', () => {
    for (const url of ['https://evil.example', '//evil.example', '/admin', '/duel/../home', 42]) {
      expect(pushTarget({ type: 'your_turn', url }).url, String(url)).toBe('/home');
    }
    expect(pushTarget({ type: 'Not A Type!', url: '/friends' }).type).toBe('unknown');
  });
});
