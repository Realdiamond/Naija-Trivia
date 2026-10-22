# 14 · Testing & QA Plan

**Version:** 1.1 · **Date:** 15 Oct 2026 · *1.1 adds the web app, the admin console and the analytics pipeline*

---

## 1. Quality goals
| Goal | Target |
|---|---|
| Crash-free sessions (overall / ≤ 3 GB RAM devices) | ≥ 99.5% / ≥ 99.3% |
| ANR rate (Play vitals) | < 0.47% (below Play's bad-behaviour threshold) |
| Gameplay logic defects in prod (scoring, timing, economy) | 0 P0/P1 per release |
| Content errors | < 1.5 confirmed wrong-answer reports per 1,000 answers |
| Regression suite runtime | < 20 min on CI |

## 2. Test pyramid

| Layer | Scope | Tools | Coverage target |
|---|---|---|---|
| **Unit** | `packages/game-rules` (scoring, timing clamp, shuffling, Glicko-2, streaks, WAT date logic), ledger, state machines | Vitest | ≥ 95% lines on game-rules, ≥ 80% on API modules |
| **Property-based** | Ledger always sums to 0; shuffle is a permutation and is deterministic per seed; score is monotonic in elapsed time; duel state machine never skips states | fast-check | Key invariants |
| **Integration** | API + Postgres + Redis in Docker (Testcontainers): duel flow, OTP, SSV callback, RevenueCat webhook, report auto-suspend | Vitest + Testcontainers | All P0 endpoints |
| **Contract** | Client ↔ API schemas (Zod/OpenAPI), realtime message shapes | Generated types + schemathesis fuzzing | 100% endpoints |
| **Realtime** | Colyseus rooms: join, start, answer, reconnect, host migration, 50-player room | `@colyseus/testing` | All room phases |
| **E2E mobile** | FTUE, sign-in, duel round, party join, daily, purchase (test SKUs), share | **Maestro** flows on emulators and real devices | Top 15 journeys |
| **E2E web app** | FTUE, sign-in (cookie session), duel turn from an invite link, party host and join, Daily, offline practice, keyboard play, PWA install | Playwright (Chromium, WebKit, Firefox) with mobile and desktop profiles | Top 15 journeys |
| **E2E web party client** | Join via link, play 10 Q, reconnect, join as a signed-in web player | Playwright (Chromium, WebKit) with mobile emulation | Top 3 journeys |
| **Admin console** | Permission matrix for every role, PII masking, an audit entry for every view and action, approvals, User 360 matching the database | Playwright + API tests | Every role × every module |
| **Analytics pipeline** | Tracking-plan contract (events and properties), PII deny-list, sessions and time spent, dedupe on retries, consent filtering, KPI reconciliation with Postgres | Vitest + ClickHouse in Testcontainers | Every event in the plan; every KPI query |
| **Visual** | Key screens in light/dark, font scale 100%/200% | Maestro screenshots + diff | Key screens |

## 3. Device & network matrix

### Real devices (in-house lab + BrowserStack/Firebase Test Lab)
| Tier | Devices |
|---|---|
| Low (2–3 GB RAM) | itel A70, Tecno Pop 8, Infinix Smart 8, Samsung Galaxy A05 |
| Mid (4–6 GB) | Tecno Spark 20, Infinix Hot 40, Redmi 13C, Samsung A15 |
| High | Samsung A55, Pixel 7a, iPhone 13 |
| Old iOS | iPhone 8 / SE 2 (iOS 15–16) |

### Browsers (web app and party client)
| Tier | Browsers |
|---|---|
| Mobile | Chrome and Samsung Internet on the low and mid Android devices; Safari on iPhone 8 / SE 2 and iPhone 13; the WhatsApp, Instagram and TikTok in-app browsers; Opera (and the "Open in Chrome" page for Opera Mini) |
| Desktop | Chrome, Edge and Firefox (latest 2) on Windows; Safari on macOS |

### Network conditions (Android emulator + Charles/`tc netem` + real SIM tests)
| Profile | Bandwidth | Latency | Loss |
|---|---|---|---|
| Good 4G | 10 Mbps | 60 ms | 0% |
| Typical 3G | 1 Mbps | 200 ms | 1% |
| Bad 3G | 400 kbps | 400 ms | 3% |
| Edge/2G | 100 kbps | 800 ms | 5% |
| Flaky (danfo) | alternates 4G ↔ offline every 20–40 s | – | – |

**Field testing:** one week in Lagos, Abuja, Kano, PH and Enugu with MTN, Airtel, Glo and T2 SIMs, measuring OTP delivery time, serve→answer latency and party reconnects.

## 4. Specific test cases (high-risk areas)

### 4.1 Timing & fairness
- TC-T1: client reports elapsed 200 ms while server elapsed is 4,000 ms → accepted elapsed ≥ server − RTT − 250 ms.
- TC-T2: answer arrives at limit + RTT + 2.1 s → timeout, 0 points.
- TC-T3: an image question's timer starts only after the image has rendered. On a slow network the image times out at 5 s, then the text-only fallback starts.
- TC-T4: an app backgrounded during a question (phone call) counts as a timeout; a 10 s network drop gives a one-time void-and-replace.

### 4.2 Duel state machine
- Every transition, including expiry at each state, forfeit winner logic, and the tiebreak path.
- Concurrency: both players submit at the same time; a duplicate answer with the same idempotency key; a different key for the same question → 409.

### 4.3 Economy
- A rewarded SSV callback replayed 5 times → one grant.
- A purchase refund webhook → coins clawed back (the balance may not go negative: the rest is recorded as debt and blocks shop spending).
- A lifeline debit fails mid-way → no effect applied (transactional).

### 4.4 Content
- CSV import rejects: > 160 chars, correct index out of range, duplicate external_ref, missing source on a factual category (warning).
- Auto-suspend at the report thresholds; a re-score job updates past duel scores and sends the notification.
- `valid_until` expiry removes the question from serving at 00:00 WAT.

### 4.5 Time zone
- Daily rollover at 00:00 WAT with device clocks set wrong (±3 h) → the server date decides.
- Streak freezes across an ISO-week boundary.

### 4.6 Privacy
- Account deletion: PII is cleared and opponents see "Deleted player".
- Contact discovery: the server logs show only 20-bit prefixes, never full numbers.
- A 13–17 account: ads are non-personalised, prize events are hidden, and there's no discoverability.

### 4.7 Web app
- JavaScript can never read the refresh token, and a cross-site request to `/auth/refresh` is rejected (CSRF).
- A duel invite link opens the turn in the browser; after signing in, the same duel shows in the app.
- Web push arrives on Android Chrome; on iPhone, only after the web app is added to the Home Screen.
- The service worker never switches versions mid-match, and practice works with the network off.
- Hiding the tab for 6 s during a question records `tab_hidden_ms` and raises an integrity signal, with no automatic penalty.
- The same account signed in on Android and the web at once keeps coins and streak consistent (ledger idempotency).

### 4.8 Admin console & analytics
- Each role sees only its modules; a direct API call outside the role returns 403 and is logged.
- Support sees masked phone numbers. **Reveal** without a reason is refused; with a reason, it creates an audit entry.
- A player's finished duel appears on their timeline within 2 minutes, and time spent is within ±5% of the device's foreground time, including a session across midnight WAT.
- A resent event batch or a retried loader insert changes no count or time total.
- A web guest merged into an existing account counts as one person in DAU and retention.
- Overview DAU, new players and matches are within ±1% of a direct database count.
- A player without analytics consent sends no detailed-behaviour events.
- Erasing a player removes their ClickHouse rows, and their timeline no longer loads.

## 5. Performance & load testing (k6 + Colyseus load-test tool)
| Scenario | Target |
|---|---|
| Async duel API | 1,000 req/s sustained, p95 < 250 ms |
| OTP burst (launch spike) | 50 sends/s with provider failover |
| Party rooms | 500 rooms × 10 players = 5,000 concurrent WS, broadcast p95 < 100 ms server-side |
| Daily at 00:00 WAT | 20k users start within 5 min |
| Soak | 4 h at 60% of peak, no memory growth > 10% |
| Chaos | Kill one realtime node mid-game → rooms recover within 10 s |
| Event ingest | 5,000 events/s sustained with p95 acceptance < 100 ms; the loader keeps ingest lag under 2 min |
| Web app | 2,000 concurrent web players in duels and the Daily alongside the app load |
| Admin console | 20 staff using dashboards during a 5,000-player load test, with no change in gameplay latency |

## 6. Content QA
- Two-person verification for every question (writer + fact-checker), and a sensitivity reviewer for flagged topics.
- **Beta "bug bash"** for content: 50 testers play 1,000 questions each week and report through the in-app tool.
- A monthly random audit of 100 live questions by the editor (target: 0 wrong answers).

## 7. Release process
1. Feature branches → PR with tests → CI (lint, typecheck, unit, integration, contract) → merge to `main` → auto-deploy to `dev`.
2. Release candidate cut weekly → `staging` → Maestro E2E on the device farm → load test (for releases touching realtime or serving) → sign-off.
3. **Android:** internal track → closed beta (500 users) → staged rollout 5% → 20% → 50% → 100%, with Play vitals and Sentry gates at each step.
4. **OTA (EAS Update)** for JS-only fixes: staged by channel, with a rollback button. Native changes always go through the store.
5. **Backend:** blue/green on ECS with automatic rollback when 5xx exceeds 2% for 5 min. The admin console and ingest service ship the same way.
6. **Web app:** each release goes to a versioned folder on S3, risky features sit behind flags, and rollback is instant (point CloudFront at the previous folder). The service worker picks up a new version at the next launch, never mid-match.

## 8. Bug severity & SLAs
| Sev | Definition | Fix SLA |
|---|---|---|
| P0 | Crash loop, data loss, money or ledger error, security | Hotfix within 24 h |
| P1 | Core flow broken for a segment (e.g. OTP on Glo) | Within 72 h |
| P2 | Degraded feature, workaround exists | Next release |
| P3 | Cosmetic | Backlog |
