/**
 * Flags, kill switches and the status banner (build plan step 2.7c): asked of the server when a
 * screen that uses them is open, and again every `refresh_s` (45 s), so a kill switch reaches
 * the player within a minute (doc 18 AD-7). Until the answer arrives, or if it can't be had, the
 * kill switches count as on: the server still refuses what is switched off.
 */
import { useQuery } from '@tanstack/react-query';
import { KILL_SWITCHES } from '@whosabi/game-rules';
import { routes, type ClientConfig } from '@whosabi/shared-types';
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
