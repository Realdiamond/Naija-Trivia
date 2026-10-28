import { QueryClient } from '@tanstack/react-query';

/** Server data cached for the screens (TanStack Query). Cleared when the player changes. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});
