/** Daily and leaderboard requests (doc 09 §2.6) and the cached views the screens share. */
import { useQuery } from '@tanstack/react-query';
import {
  routes,
  type AnswerRequest,
  type DailyAnswerResponse,
  type DailyResult,
  type DailyToday,
  type LeaderboardResponse,
  type LeaderboardScope,
  type ServedQuestion,
} from '@whosabi/shared-types';
import { api } from '../../api';

export const dailyKeys = {
  all: ['daily'] as const,
  today: ['daily', 'today'] as const,
  result: (id: number) => ['daily', 'result', id] as const,
  board: (board: 'daily' | 'week', scope: LeaderboardScope, id?: number) =>
    ['daily', 'board', board, scope, id ?? 0] as const,
};

export function useDailyToday(enabled: boolean) {
  return useQuery({
    queryKey: dailyKeys.today,
    queryFn: () => api.get<DailyToday>(routes.dailyToday()),
    enabled,
    // A new Daily starts at midnight WAT; look again once in a while.
    staleTime: 60_000,
  });
}

export function useDailyResult(id: number, enabled: boolean) {
  return useQuery({
    queryKey: dailyKeys.result(id),
    queryFn: () => api.get<DailyResult>(routes.dailyResult(id)),
    enabled,
    retry: false,
  });
}

export function useLeaderboard(board: 'daily' | 'week', scope: LeaderboardScope, dailyId?: number) {
  return useQuery({
    queryKey: dailyKeys.board(board, scope, dailyId),
    queryFn: () =>
      api.get<LeaderboardResponse>(
        board === 'week' ? routes.weekLeaderboard(scope) : routes.dailyLeaderboard(dailyId!, scope),
      ),
    enabled: board === 'week' || dailyId !== undefined,
  });
}

export const daily = {
  serve: (id: number, seq: number) => api.post<ServedQuestion>(routes.dailyServe(id, seq)),
  answer: (id: number, seq: number, body: AnswerRequest) =>
    api.post<DailyAnswerResponse>(routes.dailyAnswer(id, seq), body),
};
