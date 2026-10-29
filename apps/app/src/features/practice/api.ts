/** Packs and Practice requests (doc 09 §2.4, step 2.8f). */
import { useQuery } from '@tanstack/react-query';
import { routes, type PackUnlockResponse, type PacksResponse, type PracticeSet } from '@whosabi/shared-types';
import { api } from '../../api';

export const practiceKeys = {
  all: ['practice'] as const,
  packs: ['practice', 'packs'] as const,
  set: (id: string) => ['practice', 'set', id] as const,
};

export function usePacks(enabled: boolean) {
  return useQuery({
    queryKey: practiceKeys.packs,
    queryFn: () => api.get<PacksResponse>(routes.packs()),
    enabled,
    retry: false,
  });
}

export const practice = {
  set: (id: string) => api.get<PracticeSet>(routes.packPractice(id)),
  unlock: (id: string) => api.post<PackUnlockResponse>(routes.packUnlock(id)),
};
