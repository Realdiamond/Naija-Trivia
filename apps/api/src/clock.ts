/** Injectable time source, so tests can control answer timing exactly. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
