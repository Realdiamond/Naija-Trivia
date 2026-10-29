/** Duel requests (doc 09 §2.5) and the cached views the screens share. */
import { useQuery } from '@tanstack/react-query';
import {
  routes,
  type AnswerRequest,
  type CreateDuelRequest,
  type CreateDuelResponse,
  type DuelAnswerResponse,
  type DuelView,
  type InvitePreview,
  type LifelineRequest,
  type LifelineResponse,
  type ListDuelsResponse,
  type ServedQuestion,
  type TiebreakAnswerRequest,
  type TiebreakAnswerResponse,
} from '@whosabi/shared-types';
import { api } from '../../api';
import { answerKey } from './format';

export const duelKeys = {
  all: ['duels'] as const,
  list: (state: 'active' | 'done') => ['duels', 'list', state] as const,
  one: (id: string) => ['duels', 'one', id] as const,
};

export function useDuelList(state: 'active' | 'done', enabled: boolean) {
  return useQuery({
    queryKey: duelKeys.list(state),
    queryFn: () =>
      api.get<ListDuelsResponse>(`${routes.duels()}?state=${state}&limit=${state === 'active' ? 50 : 5}`),
    enabled,
    // No push notifications yet (step 2.5): look again now and then while the list is open.
    refetchInterval: 30_000,
  });
}

export function useDuel(id: string) {
  return useQuery({
    queryKey: duelKeys.one(id),
    queryFn: () => api.get<DuelView>(routes.duel(id)),
    // Look again now and then while waiting for the opponent; often while a random duel looks
    // for one, or the Sabi Bot is about to play (it takes well under a minute).
    refetchInterval: (query) => {
      const duel = query.state.data;
      if (duel?.next?.action !== 'wait') return false;
      return duel.source === 'bot' || (duel.source === 'random' && !duel.opponent) ? 5_000 : 15_000;
    },
  });
}

const idempotent = (key: string) => ({ headers: { 'idempotency-key': key } });

export const duels = {
  /** `key` stays the same for one tap on "Challenge", so a retried request starts one duel. */
  create: (opponent: CreateDuelRequest['opponent'], key: string) =>
    api.post<CreateDuelResponse>(routes.duels(), { opponent }, idempotent(key)),
  pickCategory: (id: string, round: number, categoryId: string) =>
    api.post<DuelView>(routes.duelCategory(id, round), { category_id: categoryId }),
  serve: (id: string, round: number, seq: number) =>
    api.post<ServedQuestion>(routes.duelServe(id, round, seq)),
  /** Step 2.4b. A retry of the same lifeline costs nothing more. */
  lifeline: (id: string, body: LifelineRequest) => api.post<LifelineResponse>(routes.duelLifeline(id), body),
  answer: (id: string, round: number, seq: number, body: AnswerRequest) =>
    api.post<DuelAnswerResponse>(
      routes.duelAnswer(id, round, seq),
      body,
      idempotent(answerKey(id, round, seq)),
    ),
  tiebreakAnswer: (id: string, body: TiebreakAnswerRequest) =>
    api.post<TiebreakAnswerResponse>(routes.duelAnswer(id, 4, 1), body, idempotent(answerKey(id, 4, 1))),
  decline: (id: string) => api.post<DuelView>(routes.duelDecline(id)),
  cancel: (id: string) => api.post<DuelView>(routes.duelCancel(id)),
  rematch: (id: string) => api.post<DuelView>(routes.duelRematch(id)),
  invite: (token: string) => api.get<InvitePreview>(routes.invite(token), { auth: 'none' }),
  accept: (token: string) => api.post<DuelView>(routes.inviteAccept(token)),
};
