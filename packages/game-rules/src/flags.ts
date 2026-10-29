/**
 * Feature flags and kill switches (doc 18 §11, build plan step 2.7c), worked out on the server
 * for each player. A flag that is off is off for everyone. One that is on applies to everyone
 * when it has no rules; otherwise a player gets it when any rule matches: their platform, an app
 * version at least the one named, and a stable share of players (the same player always lands in
 * the same bucket for a flag, on every device).
 */
import { xxh64 } from './hash';

export type FlagPlatform = 'android' | 'ios' | 'web';

export interface FlagRule {
  platform?: FlagPlatform;
  /** e.g. '1.2.0'; a player whose app version is unknown doesn't match. */
  min_app_version?: string;
  /** 0–100; without a signed-in player only 100 matches. */
  percent?: number;
}

export interface Flag {
  key: string;
  enabled: boolean;
  rules: readonly FlagRule[];
}

export interface FlagAudience {
  userId?: string | null;
  platform?: FlagPlatform | null;
  appVersion?: string | null;
}

/** The kill switches (doc 18 §11): on unless staff switch them off. */
export const KILL_SWITCHES = ['ads.enabled', 'shop.enabled', 'party.enabled'] as const;
export type KillSwitch = (typeof KILL_SWITCHES)[number];

/** Compares dotted versions number by number ('1.10.0' is after '1.9.2'); null if either isn't one. */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) => (/^\d+(\.\d+){0,3}$/.test(v) ? v.split('.').map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** A player's bucket for a flag, 0–99. */
export function flagBucket(key: string, userId: string): number {
  return Number(xxh64(`${key}:${userId}`) % 100n);
}

function matches(key: string, rule: FlagRule, who: FlagAudience): boolean {
  if (rule.platform && rule.platform !== who.platform) return false;
  if (rule.min_app_version) {
    const cmp = who.appVersion ? compareVersions(who.appVersion, rule.min_app_version) : null;
    if (cmp === null || cmp < 0) return false;
  }
  if (rule.percent !== undefined && rule.percent < 100) {
    if (!who.userId || flagBucket(key, who.userId) >= rule.percent) return false;
  }
  return true;
}

export function flagOn(flag: Flag, who: FlagAudience): boolean {
  if (!flag.enabled) return false;
  return flag.rules.length === 0 || flag.rules.some((rule) => matches(flag.key, rule, who));
}
