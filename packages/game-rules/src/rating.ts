/**
 * Glicko-2 ratings (GDD §4.2), following Glickman's "Example of the Glicko-2 system".
 * One rating per player overall, plus one per category for category badges.
 */

export interface Rating {
  rating: number;
  /** Rating deviation. */
  rd: number;
  volatility: number;
}

export interface GameResult {
  opponent: Rating;
  /** 1 = win, 0.5 = draw, 0 = loss. */
  score: 0 | 0.5 | 1;
}

export interface Glicko2Options {
  /** System constant; constrains volatility change (0.3–1.2). */
  tau?: number;
  /** Convergence tolerance for the volatility iteration. */
  epsilon?: number;
}

export const NEW_PLAYER_RATING: Rating = { rating: 1500, rd: 350, volatility: 0.06 };

const SCALE = 173.7178;
const MAX_RD = 350;

export function updateRating(
  player: Rating,
  results: readonly GameResult[],
  options: Glicko2Options = {},
): Rating {
  const tau = options.tau ?? 0.5;
  const epsilon = options.epsilon ?? 0.000001;
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;

  if (results.length === 0) {
    // No games this period: only the deviation grows.
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: Math.min(phiStar * SCALE, MAX_RD), volatility: sigma };
  }

  let vInverse = 0;
  let improvement = 0;
  for (const { opponent, score } of results) {
    const muJ = (opponent.rating - 1500) / SCALE;
    const phiJ = opponent.rd / SCALE;
    const g = 1 / Math.sqrt(1 + (3 * phiJ * phiJ) / (Math.PI * Math.PI));
    const expected = 1 / (1 + Math.exp(-g * (mu - muJ)));
    vInverse += g * g * expected * (1 - expected);
    improvement += g * (score - expected);
  }
  const v = 1 / vInverse;
  const delta = v * improvement;

  // New volatility: solve f(x) = 0 with the Illinois algorithm (step 5).
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > epsilon) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  const newSigma = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * improvement;
  return { rating: newMu * SCALE + 1500, rd: Math.min(newPhi * SCALE, MAX_RD), volatility: newSigma };
}

/** Games the same two players can finish in this window before rating gains shrink (doc 10 §2). */
export const PAIR_FREE_GAMES = 3;
export const PAIR_WINDOW_MS = 24 * 3600 * 1000;

/**
 * Anti win-trading (doc 10 §2): once a pair has finished PAIR_FREE_GAMES duels in 24 h, each
 * further game halves the rating either player can gain from it. Losses still count in full.
 * `pairGamesBefore` counts the pair's finished games in the window, not including this one.
 */
export function dampenPairGain(delta: number, pairGamesBefore: number): number {
  if (delta <= 0 || pairGamesBefore < PAIR_FREE_GAMES) return delta;
  return delta * 0.5 ** (pairGamesBefore - PAIR_FREE_GAMES + 1);
}

export const TIERS = [
  { id: 'jjc', name: 'JJC (Johnny Just Come)', badge: '🐣', minRating: Number.NEGATIVE_INFINITY },
  { id: 'learner', name: 'Learner', badge: '📘', minRating: 1300 },
  { id: 'sharp', name: 'Sharp Guy / Sharp Babe', badge: '⚡', minRating: 1500 },
  { id: 'oga', name: 'Oga', badge: '👔', minRating: 1700 },
  { id: 'chairman', name: 'Chairman', badge: '🎩', minRating: 1900 },
  { id: 'baba_sabi', name: 'Baba / Mama Sabi', badge: '👑', minRating: 2100 },
] as const;

export type Tier = (typeof TIERS)[number];

export function tierForRating(rating: number): Tier {
  let tier: Tier = TIERS[0];
  for (const t of TIERS) if (rating >= t.minRating) tier = t;
  return tier;
}

/** Quarterly soft reset (doc 16 §1): halfway back towards 1500. */
export function seasonSoftReset(rating: number): number {
  return 1500 + 0.5 * (rating - 1500);
}
