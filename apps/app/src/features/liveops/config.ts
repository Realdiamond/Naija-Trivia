/**
 * Flags, kill switches and the status banner (build plan step 2.7c): asked of the server when a
 * screen that uses them is open, and again every `refresh_s` (45 s), so a kill switch reaches
 * the player within a minute (doc 18 AD-7). Until the answer arrives, or if it can't be had, the
 * kill switches count as on: the server still refuses what is switched off.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_CONFIG, KILL_SWITCHES, type GameConfig } from '@whosabi/game-rules';
import { routes, type ClientConfig } from '@whosabi/shared-types';
import { trackEvent } from '../../analytics';
import { api } from '../../api';

export const configKey = ['config'] as const;

export function useRemoteConfig() {
  return useQuery({
    queryKey: configKey,
    queryFn: () => api.get<ClientConfig>(routes.config()),
    staleTime: 15_000,
    refetchInterval: (query) => (query.state.data?.refresh_s ?? 45) * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useFlag(key: string): boolean {
  const config = useRemoteConfig();
  return config.data?.flags[key] ?? (KILL_SWITCHES as readonly string[]).includes(key);
}

/** The game and economy values in force: the defaults with what staff tuned (step 2.7g). */
export function useGameConfig(): GameConfig {
  const values = useRemoteConfig().data?.values;
  return values ? ({ ...DEFAULT_CONFIG, ...values } as GameConfig) : DEFAULT_CONFIG;
}

const exposed = new Set<string>();

/**
 * The variant of a running experiment this player is in (step 2.7s), or null when they aren't in
 * it: show the control then. Using the answer to change what the player sees logs
 * `experiment_exposed` once a session, so only players who saw a difference are counted.
 */
export function useExperiment(key: string): string | null {
  const variant = useRemoteConfig().data?.experiments[key] ?? null;
  useEffect(() => {
    if (!variant || exposed.has(`${key}:${variant}`)) return;
    exposed.add(`${key}:${variant}`);
    trackEvent('experiment_exposed', { experiment: key, variant });
  }, [key, variant]);
  return variant;
}
