/** API paths, relative to the base URL (e.g. https://api.whosabi.ng). */
export const API_PREFIX = '/v1';

export const routes = {
  health: () => '/health',
  authGuest: () => `${API_PREFIX}/auth/guest`,
  authRefresh: () => `${API_PREFIX}/auth/refresh`,
  authLogout: () => `${API_PREFIX}/auth/logout`,
  me: () => `${API_PREFIX}/me`,
  categories: () => `${API_PREFIX}/categories`,
  rounds: () => `${API_PREFIX}/rounds`,
  round: (roundId: string) => `${API_PREFIX}/rounds/${encodeURIComponent(roundId)}`,
  serve: (roundId: string, seq: number) =>
    `${API_PREFIX}/rounds/${encodeURIComponent(roundId)}/questions/${seq}/serve`,
  answer: (roundId: string, seq: number) =>
    `${API_PREFIX}/rounds/${encodeURIComponent(roundId)}/questions/${seq}/answer`,
  /** Served by the ingest service, routed by the load balancer (doc 09 §2.11). */
  events: () => `${API_PREFIX}/events`,
} as const;
