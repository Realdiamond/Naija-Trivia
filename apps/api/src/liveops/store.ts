/**
 * Flags, kill switches, the status banner (doc 18 §11, build plan step 2.7c) and the game and
 * economy values staff tuned (step 2.7g), worked out on the server. Each API process keeps them for 10 seconds and apps look again every 45, so a
 * kill switch reaches every player within a minute (doc 18 AD-7); a change made through this
 * process applies here at once.
 */
import type { FastifyRequest } from 'fastify';
import {
  DEFAULT_CONFIG,
  flagOn,
  KILL_SWITCHES,
  TUNABLE,
  tunable,
  type Flag,
  type FlagAudience,
  type FlagPlatform,
  type GameConfig,
} from '@whosabi/game-rules';
import { ErrorCode, StatusBanner, type ClientConfig } from '@whosabi/shared-types';
import type { Pool } from '../db';
import { ApiError } from '../errors';

const CACHE_MS = 10_000;
export const CONFIG_REFRESH_S = 45;
export const BANNER_KEY = 'status_banner';

interface Snapshot {
  at: number;
  flags: Map<string, Flag>;
  banner: StatusBanner | null;
  /** The defaults with staff's changes on top (step 2.7g). */
  values: GameConfig;
}

/** A stored value counts only if it is one staff may change, and within its bounds. */
export function tunedValue(key: string, value: unknown): number | null {
  const t = tunable(key);
  return t && typeof value === 'number' && Number.isInteger(value) && value >= t.min && value <= t.max
    ? value
    : null;
}

const PLATFORMS: readonly FlagPlatform[] = ['android', 'ios', 'web'];

/** Who is asking: the signed-in player, or what the app says about itself. */
export function audienceOf(request: FastifyRequest): FlagAudience {
  const header = (name: string) => {
    const value = request.headers[name];
    return typeof value === 'string' && value.length <= 32 ? value : null;
  };
  const claimed = header('x-platform') as FlagPlatform | null;
  return {
    userId: request.auth?.userId ?? null,
    platform: request.auth?.platform ?? (claimed && PLATFORMS.includes(claimed) ? claimed : null),
    appVersion: header('x-app-version'),
  };
}

export class LiveOpsStore {
  private snapshot: Snapshot | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly now: () => number,
  ) {}

  private async current(): Promise<Snapshot> {
    const now = this.now();
    if (this.snapshot && now - this.snapshot.at < CACHE_MS) return this.snapshot;
    const [flags, config] = await Promise.all([
      this.pool.query<{ key: string; enabled: boolean; rules: Flag['rules'] }>(
        'SELECT key, enabled, rules FROM feature_flags',
      ),
      this.pool.query<{ key: string; value: unknown }>('SELECT key, value FROM app_config'),
    ]);
    const values: Record<string, number> = { ...DEFAULT_CONFIG };
    let banner: unknown = null;
    for (const row of config.rows) {
      if (row.key === BANNER_KEY) banner = row.value;
      const tuned = tunedValue(row.key, row.value);
      if (tuned !== null) values[row.key] = tuned;
    }
    const shown = StatusBanner.safeParse(banner);
    this.snapshot = {
      at: now,
      flags: new Map(flags.rows.map((f) => [f.key, f])),
      banner: shown.success ? shown.data : null,
      values: values as GameConfig,
    };
    return this.snapshot;
  }

  /** After a change made here: the next look reads the database. */
  forget(): void {
    this.snapshot = null;
  }

  /** A flag nobody has made is off; a kill switch is on until someone switches it off. */
  async isOn(key: string, who: FlagAudience): Promise<boolean> {
    const flag = (await this.current()).flags.get(key);
    if (!flag) return (KILL_SWITCHES as readonly string[]).includes(key);
    return flagOn(flag, who);
  }

  /** A 503 `FEATURE_OFF` with words for the player when `key` is off for them. */
  async require(key: string, who: FlagAudience, detail: string): Promise<void> {
    if (!(await this.isOn(key, who))) {
      throw new ApiError(503, ErrorCode.featureOff, 'Switched off for now', detail);
    }
  }

  async forClient(who: FlagAudience): Promise<ClientConfig> {
    const snap = await this.current();
    const keys = new Set<string>([...KILL_SWITCHES, ...snap.flags.keys()]);
    const flags: Record<string, boolean> = {};
    for (const key of [...keys].sort()) flags[key] = await this.isOn(key, who);
    const values: Record<string, number> = {};
    for (const t of TUNABLE) if (t.client) values[t.key] = snap.values[t.key];
    return { flags, banner: snap.banner, values, refresh_s: CONFIG_REFRESH_S };
  }

  /** The game and economy values in force (step 2.7g). */
  async values(): Promise<GameConfig> {
    return (await this.current()).values;
  }
}

/** The values in force, or the defaults for callers without the store (some jobs and tests). */
export async function configOf(deps: { liveops?: LiveOpsStore }): Promise<GameConfig> {
  return deps.liveops ? deps.liveops.values() : DEFAULT_CONFIG;
}
