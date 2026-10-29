/** The wallet (doc 09 §2.8): coins on Home, and what moved them on the Coins screen. */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { routes, type Wallet, type WalletHistory } from '@whosabi/shared-types';
import { api } from '../../api';

export const walletKeys = {
  all: ['wallet'] as const,
  balance: ['wallet', 'balance'] as const,
  history: ['wallet', 'history'] as const,
};

export function useWallet(enabled: boolean) {
  return useQuery({
    queryKey: walletKeys.balance,
    queryFn: () => api.get<Wallet>(routes.wallet()),
    enabled,
  });
}

export function useWalletHistory(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: walletKeys.history,
    queryFn: ({ pageParam }) => api.get<WalletHistory>(routes.walletHistory(pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled,
  });
}
