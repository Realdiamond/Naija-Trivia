/** API paths, relative to the base URL (e.g. https://api.whosabi.ng). */
export const API_PREFIX = '/v1';

export const routes = {
  health: () => '/health',
  authGuest: () => `${API_PREFIX}/auth/guest`,
  authRefresh: () => `${API_PREFIX}/auth/refresh`,
  authLogout: () => `${API_PREFIX}/auth/logout`,
  authLogoutAll: () => `${API_PREFIX}/auth/logout-all`,
  authOtpSend: () => `${API_PREFIX}/auth/otp/send`,
  authOtpVerify: () => `${API_PREFIX}/auth/otp/verify`,
  authGoogle: () => `${API_PREFIX}/auth/google`,
  authApple: () => `${API_PREFIX}/auth/apple`,
  me: () => `${API_PREFIX}/me`,
  meAge: () => `${API_PREFIX}/me/age`,
  user: (username: string) => `${API_PREFIX}/users/${encodeURIComponent(username)}`,
  friends: () => `${API_PREFIX}/friends`,
  friend: (userId: string) => `${API_PREFIX}/friends/${encodeURIComponent(userId)}`,
  friendRequests: () => `${API_PREFIX}/friends/requests`,
  friendAccept: (userId: string) => `${API_PREFIX}/friends/requests/${encodeURIComponent(userId)}/accept`,
  friendDecline: (userId: string) => `${API_PREFIX}/friends/requests/${encodeURIComponent(userId)}/decline`,
  blocks: () => `${API_PREFIX}/blocks`,
  block: (userId: string) => `${API_PREFIX}/blocks/${encodeURIComponent(userId)}`,
  discovery: () => `${API_PREFIX}/discovery/prefixes`,
  ping: () => `${API_PREFIX}/ping`,
  pong: (pingId: string) => `${API_PREFIX}/ping/${encodeURIComponent(pingId)}`,
  categories: () => `${API_PREFIX}/categories`,
  rounds: () => `${API_PREFIX}/rounds`,
  round: (roundId: string) => `${API_PREFIX}/rounds/${encodeURIComponent(roundId)}`,
  serve: (roundId: string, seq: number) =>
    `${API_PREFIX}/rounds/${encodeURIComponent(roundId)}/questions/${seq}/serve`,
  answer: (roundId: string, seq: number) =>
    `${API_PREFIX}/rounds/${encodeURIComponent(roundId)}/questions/${seq}/answer`,
  duels: () => `${API_PREFIX}/duels`,
  duel: (duelId: string) => `${API_PREFIX}/duels/${encodeURIComponent(duelId)}`,
  duelCategory: (duelId: string, round: number) =>
    `${API_PREFIX}/duels/${encodeURIComponent(duelId)}/rounds/${round}/category`,
  /** Round 4 is the tie-break (seq 1). */
  duelServe: (duelId: string, round: number, seq: number) =>
    `${API_PREFIX}/duels/${encodeURIComponent(duelId)}/rounds/${round}/questions/${seq}/serve`,
  duelAnswer: (duelId: string, round: number, seq: number) =>
    `${API_PREFIX}/duels/${encodeURIComponent(duelId)}/rounds/${round}/questions/${seq}/answer`,
  duelDecline: (duelId: string) => `${API_PREFIX}/duels/${encodeURIComponent(duelId)}/decline`,
  duelCancel: (duelId: string) => `${API_PREFIX}/duels/${encodeURIComponent(duelId)}/cancel`,
  duelRematch: (duelId: string) => `${API_PREFIX}/duels/${encodeURIComponent(duelId)}/rematch`,
  invite: (token: string) => `${API_PREFIX}/invites/${encodeURIComponent(token)}`,
  inviteAccept: (token: string) => `${API_PREFIX}/invites/${encodeURIComponent(token)}/accept`,
  /** Served by the ingest service, routed by the load balancer (doc 09 §2.11). */
  events: () => `${API_PREFIX}/events`,
} as const;
