/**
 * Experiments (doc 13 §4, doc 18 §11, build plan step 2.7s), on the same footing as flags: a
 * running experiment takes a stable share of the players it is for (a platform, an app version
 * at least the one named), and each of them lands in one variant by weight. Both come from
 * hashing the experiment's key with the player's id, so a player keeps their variant on every
 * device and platform.
 */
import { compareVersions, type FlagAudience, type FlagPlatform } from './flags';
import { xxh64 } from './hash';

export type ExperimentStatus = 'draft' | 'running' | 'stopped';

export interface ExperimentVariant {
  key: string;
  /** Relative: weights 50 and 50 split players evenly. */
  weight: number;
}

export interface ExperimentAudience {
  platforms?: readonly FlagPlatform[];
  /** e.g. '1.2.0'; a player whose app version is unknown is left out. */
  min_app_version?: string;
  /** Share of the players it is for who take part, 1–100. */
  percent: number;
}

export interface Experiment {
  key: string;
  status: ExperimentStatus;
  variants: readonly ExperimentVariant[];
  audience: ExperimentAudience;
}

/** The variant a player is in, or null when they aren't in the experiment (or it isn't running). */
export function variantFor(experiment: Experiment, who: FlagAudience): string | null {
  if (experiment.status !== 'running' || !who.userId) return null;
  const { platforms, min_app_version: minVersion, percent } = experiment.audience;
  if (platforms && platforms.length > 0 && (!who.platform || !platforms.includes(who.platform))) return null;
  if (minVersion) {
    const cmp = who.appVersion ? compareVersions(who.appVersion, minVersion) : null;
    if (cmp === null || cmp < 0) return null;
  }
  if (Number(xxh64(`${experiment.key}:in:${who.userId}`) % 100n) >= percent) return null;
  const total = experiment.variants.reduce((sum, v) => sum + Math.max(0, v.weight), 0);
  if (total <= 0) return null;
  let pick = Number(xxh64(`${experiment.key}:${who.userId}`) % BigInt(total));
  for (const v of experiment.variants) {
    const weight = Math.max(0, v.weight);
    if (pick < weight) return v.key;
    pick -= weight;
  }
  return null;
}
