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
  authEmailSend: () => `${API_PREFIX}/auth/email/send`,
  authEmailVerify: () => `${API_PREFIX}/auth/email/verify`,
  authGoogle: () => `${API_PREFIX}/auth/google`,
  authApple: () => `${API_PREFIX}/auth/apple`,
  me: () => `${API_PREFIX}/me`,
  /** The Profile screen's numbers (step 2.11). */
  meStats: () => `${API_PREFIX}/me/stats`,
  /** The player's friend code: their link and its QR code (step 2.12). */
  meFriendCode: () => `${API_PREFIX}/me/friend-code`,
  /** The player saw a notice from the team (step 2.7d). */
  noticeSeen: (id: number) => `${API_PREFIX}/me/notices/${id}/seen`,
  /** Delete my account, and a copy of my data (step 2.8a). */
  meDelete: () => `${API_PREFIX}/me/delete`,
  meExport: () => `${API_PREFIX}/me/export`,
  meAge: () => `${API_PREFIX}/me/age`,
  /** A parent's or guardian's consent for a 13–17 account (step 2.8d). */
  meGuardianSend: () => `${API_PREFIX}/me/guardian/send`,
  meGuardianVerify: () => `${API_PREFIX}/me/guardian/verify`,
  meConsents: () => `${API_PREFIX}/me/consents`,
  /** POST to turn pushes on for this phone, DELETE (same body shape, the token) to turn them off. */
  meDevices: () => `${API_PREFIX}/me/devices`,
  /** The web push (VAPID) public key browsers subscribe with. */
  pushWebKey: () => `${API_PREFIX}/push/web-key`,
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
  questionReports: (qid: string) => `${API_PREFIX}/questions/${encodeURIComponent(qid)}/reports`,
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
  /** A lifeline on the question being played (step 2.4b). */
  duelLifeline: (duelId: string) => `${API_PREFIX}/duels/${encodeURIComponent(duelId)}/lifelines`,
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
  /** Party rooms (step 2.2): make one, look one up by its code, take a seat, and the results. */
  partyRooms: () => `${API_PREFIX}/party/rooms`,
  partyRoom: (code: string) => `${API_PREFIX}/party/rooms/${encodeURIComponent(code)}`,
  partyJoin: (code: string) => `${API_PREFIX}/party/rooms/${encodeURIComponent(code)}/join`,
  /** The room's link as a QR code (SVG), for the lobby. */
  partyQr: (code: string) => `${API_PREFIX}/party/rooms/${encodeURIComponent(code)}/qr.svg`,
  partyGame: (gameId: string) => `${API_PREFIX}/party/games/${encodeURIComponent(gameId)}`,
  /** The room's WebSocket: connect with `?token=` from a seat. */
  partySocket: () => `${API_PREFIX}/party/socket`,
  /** Coins (step 2.4): the balance, and what moved it, newest first. */
  wallet: () => `${API_PREFIX}/wallet`,
  /** The coin packs, and the payment journey for staff alerts (step 2.4d). */
  shop: () => `${API_PREFIX}/shop`,
  /** Flags, kill switches and the status banner for this player (step 2.7c). */
  config: () => `${API_PREFIX}/config`,
  shopEvents: () => `${API_PREFIX}/shop/events`,
  /** Packs and Practice (step 2.8f). */
  packs: () => `${API_PREFIX}/packs`,
  packUnlock: (id: string) => `${API_PREFIX}/packs/${encodeURIComponent(id)}/unlock`,
  packPractice: (id: string) => `${API_PREFIX}/packs/${encodeURIComponent(id)}/practice`,
  practiceResults: () => `${API_PREFIX}/practice/results`,
  /** Writing to support from the app's Help screen, and the player's own messages (step 2.7p). */
  supportTickets: () => `${API_PREFIX}/support/tickets`,
  /** Rewarded ads (step 2.4c): what one pays and how many more will pay today. */
  rewardedAds: () => `${API_PREFIX}/ads/rewarded`,
  walletHistory: (before?: string) =>
    `${API_PREFIX}/wallet/history${before ? `?before=${encodeURIComponent(before)}` : ''}`,
  invite: (token: string) => `${API_PREFIX}/invites/${encodeURIComponent(token)}`,
  inviteAccept: (token: string) => `${API_PREFIX}/invites/${encodeURIComponent(token)}/accept`,
  /** Share pictures for WhatsApp Status (PNG, 1080×1920), for the players in it only. */
  shareDuelCard: (duelId: string) => `${API_PREFIX}/share/duels/${encodeURIComponent(duelId)}/card.png`,
  shareDailyCard: (dailyId: number) => `${API_PREFIX}/share/daily/${dailyId}/card.png`,
  admin: {
    authGoogle: () => '/admin/auth/google',
    authDev: () => '/admin/auth/dev',
    /** Staff tools on a phone: a 30-day session (step 2.9a). */
    authPhone: () => '/admin/auth/phone',
    authPhoneDev: () => '/admin/auth/phone/dev',
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
    questions: () => '/admin/questions',
    question: (id: string) => `/admin/questions/${encodeURIComponent(id)}`,
    questionAction: (id: string) => `/admin/questions/${encodeURIComponent(id)}/actions`,
    questionsPublish: () => '/admin/questions/publish',
    questionsImport: () => '/admin/questions/import',
    reports: () => '/admin/reports',
    overview: () => '/admin/overview',
    /** The console's Overview and Live (step 2.7a). */
    consoleOverview: () => '/admin/console/overview',
    /** User 360's other tabs, notes and support's actions (step 2.7b). */
    userSessions: (id: string) => `/admin/users/${encodeURIComponent(id)}/sessions`,
    userMatches: (id: string) => `/admin/users/${encodeURIComponent(id)}/matches`,
    userMoney: (id: string) => `/admin/users/${encodeURIComponent(id)}/money`,
    userDevices: (id: string) => `/admin/users/${encodeURIComponent(id)}/devices`,
    userNotes: (id: string) => `/admin/users/${encodeURIComponent(id)}/notes`,
    userActions: (id: string) => `/admin/users/${encodeURIComponent(id)}/actions`,
    /** Moderation history and integrity flags (step 2.7d). */
    userSafety: (id: string) => `/admin/users/${encodeURIComponent(id)}/safety`,
    integrity: (status?: string) =>
      `/admin/integrity${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    integrityReview: (id: number) => `/admin/integrity/${id}`,
    /** LiveOps: flags, kill switches and the status banner (step 2.7c). */
    /** The Daily scheduler (step 2.7f). */
    dailyCalendar: () => '/admin/daily',
    dailyPlan: () => '/admin/daily/plan',
    daily: (date: string) => `/admin/daily/${encodeURIComponent(date)}`,
    dailyCandidates: (date: string, slot: number) =>
      `/admin/daily/${encodeURIComponent(date)}/candidates?slot=${slot}`,
    dailySwap: (date: string) => `/admin/daily/${encodeURIComponent(date)}/swap`,
    /** Game and economy values (step 2.7g). */
    config: () => '/admin/config',
    configValue: (key: string) => `/admin/config/${encodeURIComponent(key)}`,
    configHistory: (key: string) => `/admin/config/${encodeURIComponent(key)}/history`,
    configRollback: (key: string) => `/admin/config/${encodeURIComponent(key)}/rollback`,
    configPlatform: (key: string) => `/admin/config/${encodeURIComponent(key)}/platform`,
    /** Compliance: data requests, exports and erasure (step 2.8a). */
    dsar: (status?: string) => `/admin/dsar${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    userDsar: (id: string) => `/admin/users/${encodeURIComponent(id)}/dsar`,
    complianceOverview: '/admin/compliance/overview',
    accessReview: '/admin/compliance/access-review',
    /** Support's queue, and marking a message answered (step 2.7p). */
    support: (status: 'open' | 'answered' = 'open') => `/admin/support?status=${status}`,
    supportTicket: (id: string) => `/admin/support/${encodeURIComponent(id)}`,
    userTickets: (id: string) => `/admin/users/${encodeURIComponent(id)}/tickets`,
    /** Packs in the Content module (step 2.8f). */
    packs: '/admin/packs',
    pack: (id: string) => `/admin/packs/${encodeURIComponent(id)}`,
    packQuestions: (id: string) => `/admin/packs/${encodeURIComponent(id)}/questions`,
    packQuestion: (id: string, qid: string) =>
      `/admin/packs/${encodeURIComponent(id)}/questions/${encodeURIComponent(qid)}`,
    segments: '/admin/segments',
    segment: (id: string) => `/admin/segments/${encodeURIComponent(id)}`,
    segmentCount: '/admin/segments/count',
    segmentExports: (id: string) => `/admin/segments/${encodeURIComponent(id)}/exports`,
    segmentExportDecision: (id: string) => `/admin/segment-exports/${encodeURIComponent(id)}/decision`,
    segmentExportDownload: (id: string) => `/admin/segment-exports/${encodeURIComponent(id)}/download`,
    userExport: (id: string) => `/admin/users/${encodeURIComponent(id)}/export`,
    userErase: (id: string) => `/admin/users/${encodeURIComponent(id)}/erase`,
    flags: () => '/admin/flags',
    flag: (key: string) => `/admin/flags/${encodeURIComponent(key)}`,
    banner: () => '/admin/banner',
    /** Experiments (step 2.7s). */
    experiments: () => '/admin/experiments',
    experiment: (key: string) => `/admin/experiments/${encodeURIComponent(key)}`,
    /** Store purchases, refunds and the export for finance (step 2.7i). */
    commerce: (query = '') => `/admin/commerce${query}`,
    commerceExport: (month: string) => `/admin/commerce/export?month=${encodeURIComponent(month)}`,
    analytics: (board: string, query = '') => `/admin/analytics/${encodeURIComponent(board)}${query}`,
    /** A dashboard's numbers as CSV, with a reason (step 2.7r). */
    analyticsExport: (board: string, query: string) =>
      `/admin/analytics/${encodeURIComponent(board)}/export?${query}`,
    alertRules: '/admin/alert-rules',
    alertRule: (id: string) => `/admin/alert-rules/${encodeURIComponent(id)}`,
    /** Home banners and events (step 2.7h). */
    events: () => '/admin/events',
    eventEnd: (id: number) => `/admin/events/${id}/end`,
    liveOnline: (platform?: string) => `/admin/live/online${platform ? `?platform=${platform}` : ''}`,
    liveRooms: () => '/admin/live/rooms',
    liveFeed: (after?: string) => `/admin/live/feed${after ? `?after=${encodeURIComponent(after)}` : ''}`,
    liveKick: (code: string) => `/admin/live/rooms/${encodeURIComponent(code)}/kick`,
    liveClose: (code: string) => `/admin/live/rooms/${encodeURIComponent(code)}/close`,
    phones: () => '/admin/phones',
    revokePhone: (id: string) => `/admin/phones/${encodeURIComponent(id)}/revoke`,
    /** This phone's push token, for staff alerts (phone sessions only). */
    phonePush: () => '/admin/phones/push',
    alerts: (before?: string) => `/admin/alerts${before ? `?before=${encodeURIComponent(before)}` : ''}`,
    alertsSeen: () => '/admin/alerts/seen',
    alertSettings: () => '/admin/alerts/settings',
    resolveReports: (id: string) => `/admin/questions/${encodeURIComponent(id)}/reports/resolve`,
  },
  /** Served by the ingest service, routed by the load balancer (doc 09 §2.11). */
  events: () => `${API_PREFIX}/events`,
} as const;
