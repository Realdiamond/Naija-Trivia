/** API paths, relative to the base URL (e.g. https://api.whosabi.ng). */
export const API_PREFIX = '/v1';

export const routes = {
  health: () => '/health',
  authMethods: () => `${API_PREFIX}/auth/methods`,
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
  meConsents: () => `${API_PREFIX}/me/consents`,
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
  dailyToday: () => `${API_PREFIX}/daily/today`,
  dailyServe: (dailyId: number, seq: number) => `${API_PREFIX}/daily/${dailyId}/questions/${seq}/serve`,
  dailyAnswer: (dailyId: number, seq: number) => `${API_PREFIX}/daily/${dailyId}/questions/${seq}/answer`,
  dailyResult: (dailyId: number) => `${API_PREFIX}/daily/${dailyId}/result`,
  dailyLeaderboard: (dailyId: number, scope: 'global' | 'state' | 'friends') =>
    `${API_PREFIX}/daily/${dailyId}/leaderboard?scope=${scope}`,
  /** The week's board: Daily points added up, Monday to Sunday WAT. */
  weekLeaderboard: (scope: 'global' | 'state' | 'friends') =>
    `${API_PREFIX}/leaderboards/week?scope=${scope}`,
  invite: (token: string) => `${API_PREFIX}/invites/${encodeURIComponent(token)}`,
  inviteAccept: (token: string) => `${API_PREFIX}/invites/${encodeURIComponent(token)}/accept`,
  admin: {
    authGoogle: () => '/admin/auth/google',
    authDev: () => '/admin/auth/dev',
    authLogout: () => '/admin/auth/logout',
    me: () => '/admin/me',
    users: (q: string) => `/admin/users?q=${encodeURIComponent(q)}`,
    user: (id: string) => `/admin/users/${encodeURIComponent(id)}`,
    timeline: (id: string) => `/admin/users/${encodeURIComponent(id)}/timeline`,
    reveal: (id: string) => `/admin/users/${encodeURIComponent(id)}/reveal`,
    userAudit: (id: string) => `/admin/users/${encodeURIComponent(id)}/audit`,
    audit: () => '/admin/audit',
    staff: () => '/admin/staff',
    staffRoles: (id: string) => `/admin/staff/${encodeURIComponent(id)}/roles`,
    staffRole: (id: string, role: string) =>
      `/admin/staff/${encodeURIComponent(id)}/roles/${encodeURIComponent(role)}`,
    approveRole: (id: string, role: string) =>
      `/admin/staff/${encodeURIComponent(id)}/roles/${encodeURIComponent(role)}/approve`,
  },
  /** Served by the ingest service, routed by the load balancer (doc 09 §2.11). */
  events: () => `${API_PREFIX}/events`,
} as const;
