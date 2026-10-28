# 06 · Technical Requirements Document (TRD)

**Version:** 1.1 · **Date:** 15 Oct 2026
**Related:** [07 Architecture](07-system-architecture.md) · [08 Data Model](08-data-model.md) · [09 API](09-API-and-realtime-protocol.md) · [10 Security & Compliance](10-security-anti-cheat-privacy-compliance.md) · [18 Admin Console & Analytics](18-admin-console-and-analytics.md)

> **What changed in 1.1:** a full web app built from the same Expo codebase (§4.10, §5.6), an admin console that covers everything players do (§4.9, doc 18), and a first-party analytics pipeline on ClickHouse in place of PostHog (§4.11).

---

## 1. Purpose & scope
This document turns the PRD into technical requirements: the platforms, the stack, functional behaviour of each subsystem, non-functional budgets, and constraints. It is the reference engineers build and test against.

## 2. Platforms & targets
| Platform | Minimum | Reference test devices |
|---|---|---|
| Android | Android 8.0 (API 26), 2 GB RAM supported, 3 GB+ targeted | Tecno Spark 10/20, Infinix Hot 30/40, itel A70/S23, Samsung Galaxy A05/A15, Xiaomi Redmi 12/13C |
| iOS | iOS 15+ | iPhone 8 / SE 2, iPhone 11, iPhone 13 |
| Web app | Chrome, Edge and Firefox (last 2 versions), Safari 15+ (iOS and macOS), Samsung Internet 20+, Opera (not Mini), in-app browsers (WhatsApp, Instagram, TikTok, X, Facebook) | The Android and iOS devices above, plus a Windows laptop and a MacBook |
| Web party client | Chrome Android 100+, Samsung Internet 20+, Safari 15+, WhatsApp in-app browser | Same devices |
| Admin console | Desktop Chrome, Edge, Firefox and Safari (latest); Overview and Live pages also on phones | – |

## 3. Technology stack (decisions)

| Layer | Choice | Why | Rejected alternatives |
|---|---|---|---|
| App (Android, iOS **and web**) | **React Native + Expo (current stable SDK), Expo Router, TypeScript, Hermes, New Architecture; the web build uses react-native-web** | One codebase for Android, iOS and the web app, sharing TS types with the server; OTA updates through EAS Update (instant content and UI fixes without a Play Store review); large Nigerian dev talent pool | Flutter: excellent performance, but a separate language and its web output is too heavy for low-end phones on 3G. Native Kotlin + Swift: two teams and still no web. A separate Next.js web app: a second UI to build and keep in step |
| App state | Zustand (UI state), TanStack Query (server cache), MMKV in the app and IndexedDB on the web (persistent KV) | Lightweight and fast on low-end phones | Redux |
| Web app hosting | Static export from Expo (`expo export -p web`, public pages pre-rendered), S3 + CloudFront, Workbox service worker | Cheap, fast from the Lagos edge, works offline for practice, instant rollback | Server rendering (not needed: almost everything is behind a session) |
| Web party client | **Preact + Vite**, PWA, ≤ 150 KB gzipped | Party links (`/r/{CODE}`) must load fast over 3G inside the WhatsApp browser, even though the full web app exists | The full web app for party links (≈ 350 KB first load) |
| Admin console | **Next.js + shadcn/ui + TanStack Table + ECharts** (internal), behind Google Workspace SSO, with **Metabase** (open source, self-hosted) embedded for exploration | One place for players, live activity, analytics, content, LiveOps, moderation, support and compliance (doc 18) | Retool (licence cost; fine for a v0). PostHog dashboards plus a CMS (two tools, no User 360 or actions next to the data) |
| API | **Node.js 22 LTS + Fastify + TypeScript**, Zod schemas → OpenAPI | Fast, typed, one language end-to-end | NestJS (heavier) |
| Realtime | **Colyseus** (Node) for Party Rooms, WebSocket transport, Redis presence/driver | Built for room-based multiplayer, handles reconnection and state sync, scales horizontally with Redis | Socket.IO (more custom code to write), Firebase RTDB (cost and anti-cheat), Ably/Pusher (cost per message at scale) |
| Database | **PostgreSQL 16** (managed: AWS RDS) | Relational integrity for duels, ledger and content. JSONB where flexible | MongoDB |
| Cache, leaderboards, queues | **Redis 7**. Sorted sets for leaderboards. Background jobs run in a worker process on timers, each safe to run on several workers at once; BullMQ only if a real job queue is needed later | One dependency covers several needs | Kafka (overkill) |
| Object storage / CDN | S3 + **CloudFront** (Lagos edge) | Images and audio close to users | – |
| Auth | Own auth service: phone OTP (Termii primary, Africa's Talking fallback) + Google Sign-In + Apple Sign-In (iOS). JWT access (15 min) + rotating refresh (30 days) | Local SMS routes cost about ₦8–12 per OTP. Full control of the guest-to-account merge | Firebase Auth phone (higher per-SMS cost to Nigeria, less control) |
| Push | FCM for Android, iOS (through APNs) and web push; expo-notifications in the app, the Firebase JS SDK on the web | Free and reliable, one token format everywhere | OneSignal |
| Ads | Google AdMob with mediation (AppLovin, Meta Audience Network, Unity Ads, Liftoff) via `react-native-google-mobile-ads`. Web (v1.1): Google's H5 Games Ads / Ad Manager rewarded and interstitial formats, subject to Google's approval | Best fill in Nigeria with mediation | IronSource-only |
| IAP / subscriptions | Google Play Billing + StoreKit through **RevenueCat**. Web (v1.1): **Paystack** for coins, gems and Sabi Pass | Receipt validation, entitlements and webhooks handled for us; Paystack is the local standard for card, bank and USSD payments | Building receipt validation ourselves |
| Analytics | **First-party pipeline:** `packages/analytics` SDK → ingest service → Redis stream → **ClickHouse** (ClickHouse Cloud or self-hosted). Firebase Analytics in the mobile apps only, for ads attribution | Every event in one store we control, joined with game data and shown in the admin console; fast at billions of rows; no per-event vendor bill; one processor fewer for NDPA | PostHog (good, but splits the admin across two tools and bills per event at scale). BigQuery (slower and pay-per-query for live dashboards). Postgres (won't hold a year of events) |
| Crash / perf | Sentry (React Native, web and Node) | Source maps, release health | Crashlytics (also acceptable) |
| Remote config / flags / experiments | In-house: `app_config`, `feature_flags` and `experiments` tables, evaluated on the server, cached in Redis, managed in the admin console | Tune the economy without a release; one audited place | PostHog flags |
| Bot protection | Cloudflare Turnstile on OTP sends and web guest creation | Invisible for most people, free | reCAPTCHA (heavier) |
| IaC / CI | Terraform, GitHub Actions, EAS Build | Reproducible environments | – |
| Airtime rewards (v2) | Reloadly or VTpass API | Instant sponsor payouts | Manual payout |

## 4. Functional requirements

### 4.1 Identity & accounts
- **FR-AUTH-1:** Guest account created on first launch (`device_id` + server-issued guest JWT). On the web, the `device_id` is a random browser ID kept in IndexedDB.
- **FR-AUTH-2:** Phone OTP. E.164 normalisation (+234), 6-digit code, TTL 5 min, max 5 sends/day/number, max 10/day/device, max 5 verify attempts per code. The client sends its platform and the server picks the SMS template: Android adds the SMS Retriever app hash; the web adds the WebOTP line `@whosabi.ng #123456` so Chrome on Android fills the code; iOS and other browsers use `autocomplete="one-time-code"`.
- **FR-AUTH-2a:** Email codes (build plan step 2.10), for players without Google or a phone code: the same 6-digit code, limits, human check and single use as FR-AUTH-2, a TTL of 10 minutes, sent through Resend. The address is the identity, lower-cased.
- **FR-AUTH-3:** Google / Apple sign-in using ID-token verification on the server.
- **FR-AUTH-4:** Guest-to-account merge keeps the guest's stats, coins and duels. Conflict rule: if the phone already has an account, guest progress is merged into it and coins are added.
- **FR-AUTH-5:** Account deletion completes within 30 days (NDPA right to erasure). Matches are anonymised, not deleted, so opponents' history stays valid.
- **FR-AUTH-6:** Age band captured at signup. Under 13 is blocked. 13–17 sets `restricted=true`.
- **FR-AUTH-7:** Web sessions: the access token lives in memory only. The refresh token is an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `api.whosabi.ng/v1/auth`. Refresh calls must carry an `X-Requested-With` header from an allowed `Origin`, which blocks cross-site request forgery. The apps keep their refresh token in the device keystore (expo-secure-store).
- **FR-AUTH-8:** One account works on every platform at once. Signing in on a new platform links it, and "Sign out everywhere" revokes every refresh-token family.

### 4.2 Content service
- **FR-CON-1:** Questions are stored with options (array of 2–4), `correct_index`, category, subcategory, difficulty (1–5), `d_q` rating, media refs, `family_safe`, `valid_from`/`valid_until`, `region_tag`, status (draft → in_review → approved → live → suspended → retired), and author.
- **FR-CON-2:** Question selection for a player: exclude anything the player saw in the last 30 days (using Redis bloom filters per user, with Postgres `seen` as a fallback), filter by category, family-safe flag and media mode (Data Saver), and pick by target difficulty with weighted randomness.
- **FR-CON-3:** Never send `correct_index` to the client before the answer is submitted (except offline Practice packs).
- **FR-CON-4:** Report intake, with auto-suspend thresholds from the content doc.
- **FR-CON-5:** Nightly jobs: difficulty recalibration, expiry of `valid_until`, re-bucketing, and flagging outliers.
- **FR-CON-6:** CMS bulk import from CSV (format = `content/seed-questions.csv`), with validation and dedup check.
- **FR-CON-7:** When a live question is corrected, matches from the last 14 days that used it are re-scored (async job) and affected players are notified.

### 4.3 Duel service (async)
- **FR-DUEL-1:** A state machine (see §5.2) runs on the server. Every transition is idempotent and keyed by `(duel_id, round, player)`.
- **FR-DUEL-2:** Both players get identical questions in a round. Options are shuffled per player with a deterministic seed `hash(duel_id, user_id, question_id)`.
- **FR-DUEL-3:** Turn deadline 48 h. The worker ends overdue duels every 30 s and sends reminder pushes at T-24h and T-4h (outside quiet hours).
- **FR-DUEL-4:** Answer submission is per question (streamed). The server stores `served_at` and `answered_at` (see timing §5.3).
- **FR-DUEL-5:** Offline tolerance: if the network drops during a question, the client keeps a local answer record. If it re-sends within the grace window (question time limit + 10 s), the answer is accepted with timing clamped to the limit (no speed bonus).
- **FR-DUEL-6:** Random matchmaking: a Redis queue per rating bucket (±200, widening by 100 every 10 s, max 60 s, then fall back to a "Sabi Bot" with a disclosed bot label).

### 4.4 Party service (live)
- **FR-PARTY-1:** Room code: 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Codes are unique among active rooms and reserved for 10 minutes after the room closes.
- **FR-PARTY-2:** The room lifecycle is LOBBY → COUNTDOWN → QUESTION → REVEAL → LEADERBOARD → … → PODIUM → (LOBBY for play again) → CLOSED (after 10 min idle).
- **FR-PARTY-3:** The server is authoritative for the question clock. It broadcasts `question` with `ends_at` in server time, and clients sync their clock with ping/pong offsets.
- **FR-PARTY-4:** Reconnection: Colyseus `allowReconnection(client, 60)`. Score is preserved. Questions missed while disconnected score 0.
- **FR-PARTY-5:** Host migration: if the host disconnects for more than 60 s, the longest-connected player becomes host.
- **FR-PARTY-6:** Rooms are capped at 20 (free) or 50 (Sabi Pass host). Spectators (v2) are unlimited and read-only.
- **FR-PARTY-7:** Guests from the web join with a nickname. They get a guest JWT scoped to `party:{roomId}` only. Nickname profanity filter (EN + Pidgin + Yoruba/Igbo/Hausa word lists).

### 4.5 Daily Challenge
- **FR-DAILY-1:** A job at 23:00 WAT picks tomorrow's 7 questions (one per category plus a hard "boss"), excluding questions used in a Daily in the last 365 days. Editors can override in the CMS up to 22:00.
- **FR-DAILY-2:** One attempt per user per day, enforced by a unique `(user_id, daily_id)` constraint.
- **FR-DAILY-3:** Percentile computed in real time from a Redis sorted set; state boards use one sorted set per state.
- **FR-DAILY-4:** Streak logic in WAT (Africa/Lagos, UTC+1, no DST), with one streak freeze per week.

### 4.6 Social
- **FR-SOC-1:** Friend graph (mutual) with request/accept. Recent opponents are suggested.
- **FR-SOC-2:** Contact discovery uses **k-anonymity prefix matching**, because phone numbers are too guessable for a plain hash to protect them.
  1. The client normalises each contact to E.164 and computes `SHA-256(phone)`.
  2. The client sends only the **first 20 bits** of each hash.
  3. The server returns the full hashes (and user IDs) of registered, discoverable users whose hash shares those prefixes. Each prefix matches many possible numbers.
  4. The client matches full hashes locally.

  The server never receives or stores the user's contact list. Users can opt out of being discoverable (Settings → Privacy). On the web, contact discovery is off; players add friends by username, link or QR code.
- **FR-SOC-3:** Deep links: `https://whosabi.ng/d/{token}` (duel invite), `/r/{CODE}` (party), `/u/{username}` (profile), `/daily/{n}` (Daily). Android App Links and iOS Universal Links open the app when it is installed. **Without the app, the same links open the web app**: the invitee plays their duel turn in the browser, `/daily/{n}` opens the Daily, and `/r/{CODE}` opens the light party client. **Deferred deep links** use the Play Install Referrer API (Android) and a clipboard-free server fingerprint fallback (iOS, short-lived).
- **FR-SOC-4:** Share cards are rendered on device (`react-native-view-shot` in the app; a canvas on the web, shared through the Web Share API or downloaded on desktop), and the link preview uses an OG image rendered server-side (Satori/resvg) and cached on the CDN.

### 4.7 Economy & monetisation
- **FR-ECO-1:** Coins use a **double-entry ledger** (`ledger_entries`). The balance is derived from the ledger and cached. Every grant or spend has an idempotency key.
- **FR-ECO-2:** Rewarded-ad rewards are granted only on AdMob **server-side verification (SSV)** callback, never on a client claim. Web ads (v1.1) have no SSV, so the server issues a one-time ad session when the ad is requested and grants the reward only when the completion callback returns that session after the minimum view time. Web rewards are capped at 5 a day per player and need a signed-in account.
- **FR-ECO-3:** IAP: RevenueCat webhooks → entitlement table. The client reads entitlements from our API, not directly. Web purchases (v1.1) use Paystack: the server creates the transaction, the Paystack webhook (signature checked) reports it, and the server verifies it with Paystack's API before granting anything. Both paths write to the same entitlements and ledger, so a pass bought on the web works in the app and the other way round.
- **FR-ECO-4:** Purchases never affect prize eligibility. Sponsored-prize events check `event.purchase_independent = true`, and the code path has no access to entitlements.
- **FR-ECO-5:** Remote-configurable prices and rewards.
- **FR-ECO-6:** The Android and iOS apps never mention or link to web prices (store anti-steering rules). Re-check the current Google Play and App Store rules before launch.

### 4.8 Notifications
- **FR-NOT-1:** Types: your_turn, duel_expiring, duel_result, friend_joined, daily_live, league_recap, party_invite, content_correction.
- **FR-NOT-2:** Quiet hours 22:00–07:00 WAT (except party invites from friends). Max 4 non-turn pushes a day per user.
- **FR-NOT-3:** Pidgin or English templates, based on the user's language setting.
- **FR-NOT-4:** Web push uses the same FCM token flow. On iPhone it only works after the player adds the web app to the Home Screen (iOS 16.4+), so on iPhone the web app leans on WhatsApp nudges instead.

### 4.9 Admin console
- **FR-ADM-1:** One console for players, live activity, analytics, content, LiveOps, moderation, support, commerce and compliance, specified in [doc 18](18-admin-console-and-analytics.md).
- **FR-ADM-2:** Roles: `owner`, `admin`, `analyst`, `growth`, `liveops`, `editor`, `fact_checker`, `writer`, `moderator`, `support`, `finance`, `sponsor_manager`, `dpo`, `engineer`, `viewer`. The admin API checks permissions on every request.
- **FR-ADM-3:** Content tools: question CRUD with workflow, CSV import, media upload (auto-converted to WebP/Opus and size-checked), pack builder, Daily scheduler, event and sponsor setup, report queue.
- **FR-ADM-4:** User 360 for every player: full activity timeline, sessions and time spent, matches, ledger, purchases, safety and consent (doc 18 §7).
- **FR-ADM-5:** PII is masked by default. Revealing it needs the right role and a reason. Every view of a player and every action is written to `admin_audit_log`.
- **FR-ADM-6:** The console reads from the Postgres read replica, ClickHouse and Redis, never from the primary database.

### 4.10 Web app
- **FR-WEB-1:** The web app at `whosabi.ng` is the same Expo app built for the web. Every MVP feature works there: guest play, sign-in, duels, party rooms (host and join), the Daily, practice, friends, profile, settings, share and report. Purchases and ads come to the web in v1.1 (FR-ECO-2, FR-ECO-3).
- **FR-WEB-2:** Platform-specific code sits behind small adapters with a `.native.ts` and a `.web.ts` version (§5.6). Shared screens never import a native-only library directly; a lint rule enforces this.
- **FR-WEB-3:** Installable PWA: web manifest, and a service worker that caches the app shell, fonts and practice packs, so Practice works offline. An install prompt appears after the second session (Chrome's install prompt on Android; "Add to Home Screen" steps on iPhone).
- **FR-WEB-4:** Layout: a phone-width game column (max 480 px) centred on bigger screens. From 1024 px, a side navigation replaces the tab bar, and leaderboards, profile and shop use two columns.
- **FR-WEB-5:** Keyboard: 1–4 or A–D answers, Enter continues, Esc opens the leave-match dialog. Focus is always visible.
- **FR-WEB-6:** Data Saver turns on automatically when the browser reports `saveData` or a 2G/3G connection.
- **FR-WEB-7:** Integrity: during a question the client measures how long the tab was hidden (`visibilitychange`) and sends it with the answer (`tab_hidden_ms`). It is a risk signal for the integrity job, never an automatic penalty. Every answer records its platform, so speed and accuracy can be compared across platforms.
- **FR-WEB-8:** A smart app banner on mobile browsers ("Get the app: faster, with notifications"), at most once a week and never during a match.
- **FR-WEB-9:** Opera Mini in Extreme mode can't run the app or hold a WebSocket, so it gets an "Open in Chrome" page.
- **FR-WEB-10:** Public pages (landing, pack catalogue, Daily teaser) are pre-rendered for search engines and link previews. Player profiles are `noindex`, and restricted (13–17) players have no public profile.
- **FR-WEB-11:** A cookie and consent banner on the first visit (NDPA/GAID). Before consent, only strictly necessary storage is used (session, the consent choice, the offline queue).

### 4.11 Analytics & tracking
- **FR-ANA-1:** One typed tracking plan in `packages/analytics` lists every event and property ([doc 13 §2](13-analytics-and-metrics.md)). The SDK rejects events that aren't in the plan, and CI fails on property names from the PII deny-list (phone, email, name, nickname, free text).
- **FR-ANA-2:** The client SDK queues, batches and compresses events as described in doc 18 §15, within an analytics data budget of 30 KB a day for a typical player.
- **FR-ANA-3:** Business events (answers, matches, coins, purchases, ad rewards, pushes) are emitted by the server, never trusted from the client.
- **FR-ANA-4:** The ingest service validates events, enforces consent, corrects clock skew, derives an approximate state and drops the IP, swaps the user ID for `user_pid` (HMAC-SHA256 with a key in Secrets Manager), and accepts each batch once.
- **FR-ANA-5:** ClickHouse keeps raw events for 13 months and per-person rollups for 25 months. Erasing a player deletes their rows within the DSAR window.
- **FR-ANA-6:** Analytics never slows or blocks gameplay: the SDK sends in the background, ingest is a separate service, and an outage only delays the dashboards.

## 5. Key technical designs

### 5.1 Question delivery payload (duel round)
```json
{
  "round_id": "r_01J...",
  "questions": [
    {
      "qid": "q_01J...",
      "seq": 1,
      "type": "mcq4",
      "text": "Who directed The Wedding Party (2016)?",
      "options": ["Funke Akindele", "Kemi Adetiba", "Kunle Afolayan", "Niyi Akinmolayan"],
      "media": null,
      "time_limit_ms": 15000
    }
  ]
}
```
Questions in a round are **revealed one at a time**: `POST /duels/{id}/rounds/{n}/questions/{seq}/serve` returns a single question and records `served_at`. This prevents a player from looking up all three at once.

### 5.2 Duel state machine
```
CREATED ──(A plays R1)──▶ WAIT_B_R1R2 ──(B plays R1,R2)──▶ WAIT_A_R2R3 ──(A plays R2,R3)──▶ WAIT_B_R3 ──(B plays R3)──▶ [TIEBREAK?] ──▶ COMPLETE
   │                │                      │                     │
   └──── expiry ────┴──────── expiry ──────┴────── expiry ───────┴──▶ FORFEIT (winner = waiting player)
DECLINED (B declines before playing) · CANCELLED (A cancels before B plays)
```

### 5.3 Fair timing (server-authoritative with latency tolerance)
- `served_at_s`: when the server sent the question. `recv_at_s`: when the server received the answer.
- The client reports `client_elapsed_ms`, measured from when the question became visible (after image load) to the tap.
- The server computes `server_elapsed = recv_at_s − served_at_s` and an RTT estimate (median of the last 5 pings on this session).
- **Accepted elapsed** = `clamp(client_elapsed_ms, server_elapsed − rtt_est − 250ms, server_elapsed)`, then floored at 300 ms (human minimum).
- If `server_elapsed > time_limit + rtt_est + 2,000 ms`, the answer counts as a timeout.
- Live rooms use the same rule, with `served_at` = broadcast time.
- Store all raw values for anti-cheat analysis.

### 5.4 Option shuffling
`perm = seededShuffle([0..n-1], seed = xxhash64(match_id ‖ user_id ‖ qid))`. The server stores the permutation index map. The answer is submitted as the **displayed index**, and the server maps it back.

### 5.5 Leaderboards
- Redis sorted sets: `lb:daily:{yyyymmdd}`, `lb:daily:{yyyymmdd}:state:{code}`, `lb:league:{league_id}:{iso_week}`, `lb:global:rating`.
- Nightly snapshot to Postgres for history. TTL 8 days on daily keys.

### 5.6 Platform adapters (one codebase, three platforms)
Screens call one interface; the bundler picks `adapter.native.ts` for Android and iOS, or `adapter.web.ts` for the web.

| Capability | Android / iOS | Web |
|---|---|---|
| Key-value storage | MMKV | IndexedDB (localStorage fallback) |
| Refresh token | expo-secure-store (Keystore / Keychain) | HttpOnly cookie (FR-AUTH-7) |
| Push | expo-notifications + FCM | Firebase JS SDK + service worker |
| OTP autofill | SMS Retriever (Android), iOS autofill | WebOTP (Chrome on Android), `autocomplete="one-time-code"` |
| Google sign-in | Native Google Sign-In | Google Identity Services |
| Purchases | RevenueCat (Play, App Store) | Paystack inline checkout (v1.1) |
| Ads | react-native-google-mobile-ads | H5 Games Ads / Ad Manager (v1.1) |
| Share | Native share sheet; cards from react-native-view-shot | Web Share API; canvas-drawn cards; download on desktop |
| Contacts | expo-contacts (prefix discovery) | Not available: username, link or QR code |
| Haptics | expo-haptics | None (`navigator.vibrate` on Android Chrome only) |
| Deep links | App Links / Universal Links | Web app routes |
| Analytics queue | MMKV | IndexedDB, flushed with `sendBeacon` on `pagehide` |

## 6. Non-functional requirements

| Category | Requirement | Measure |
|---|---|---|
| **Performance (app)** | Cold start ≤ 3.0 s p75 on Tecno Spark 10; JS bundle ≤ 4 MB; 60 fps on the question screen (≤ 16 ms frames) on mid devices, ≥ 45 fps on low-end | Sentry perf, Android vitals |
| **Performance (web app)** | First screen ≤ 350 KB of gzipped JavaScript (code-split by route); interactive in ≤ 6 s at p75 on a low-end Android over "Typical 3G" (doc 14), ≤ 2 s on repeat visits from the service-worker cache; LCP ≤ 2.5 s on 4G, INP ≤ 200 ms, CLS ≤ 0.1 *(inferred, confirm in S1)* | Lighthouse CI, web vitals events |
| **App size** | Download ≤ 25 MB (AAB), install ≤ 60 MB | Play Console |
| **Data budget** | Duel ≤ 1 MB with images, ≤ 300 KB in Data Saver; party game (10 Q) ≤ 400 KB; web party client first load ≤ 150 KB gz + ≤ 200 KB per game; web app first load ≤ 350 KB gz; analytics ≤ 30 KB a day for a typical player | Synthetic tests |
| **API latency** | p95 ≤ 250 ms server time for gameplay endpoints; p99 ≤ 600 ms | APM |
| **Realtime** | Broadcast fan-out ≤ 100 ms server-side; Lagos client p95 end-to-end ≤ 400 ms | Synthetic probes from Lagos/Abuja (MTN and Airtel SIMs) |
| **Scalability** | MVP: 5k concurrent live players, 50k duels a day, 100k DAU. Architecture must scale linearly to 1M DAU by adding nodes | k6 load tests |
| **Availability** | 99.5% monthly (MVP), 99.9% from v2. RPO ≤ 5 min, RTO ≤ 1 h | Uptime monitors |
| **Security** | OWASP ASVS L2. TLS 1.2+ everywhere. Secrets in AWS Secrets Manager. Pen test before launch | – |
| **Privacy** | NDPA/GAID: DPIA, consent logs, DSAR within 30 days, data minimisation | DPO sign-off |
| **Analytics** | Event to dashboard ≤ 2 min; ingest sustains 5,000 events/s with p95 acceptance ≤ 100 ms (MVP); no event counted twice | Load test, ingest-lag alert, reconciliation job |
| **Admin console** | As in doc 18 §17 (pages ≤ 2 s p75, 30-day queries ≤ 3 s p95, KPIs within ±1% of the database) | Synthetic checks, reconciliation job |
| **Observability** | Structured JSON logs, OpenTelemetry traces, RED metrics per endpoint, Grafana dashboards, PagerDuty/Opsgenie on-call | – |
| **Maintainability** | ≥ 70% unit-test coverage on game logic and economy. Contract tests between client and API (Zod/OpenAPI) | CI gates |
| **Localisation** | ICU message format and i18n keys; no hard-coded strings | Lint rule |

## 7. Environments
| Env | Purpose | Data |
|---|---|---|
| `local` | Docker Compose: Postgres, Redis, ClickHouse, API, ingest, Colyseus, admin console, Metabase | Seed CSV |
| `dev` | Every merge to `main` | Synthetic |
| `staging` | Release candidates, load tests, beta testers | Anonymised copy of content only |
| `prod` | Live | Real |

## 8. Third-party dependencies & fallback
| Dependency | Failure impact | Fallback |
|---|---|---|
| Termii (OTP) | No phone login | Africa's Talking automatically after 2 failures; Google sign-in |
| FCM | No pushes | In-app inbox; WhatsApp share nudges |
| AdMob | No ad revenue | Mediation partners; direct-sold sponsor placements |
| RevenueCat | Purchases delayed | Cached entitlements valid for 72 h; webhook replay |
| CloudFront/S3 | No images | Text-only fallback (Data Saver path) |
| Reloadly/VTpass (v2) | Prize delay | Queue and retry; manual payout SLA of 48 h |
| Paystack (v1.1, web) | No web purchases | Purchases in the apps still work; the web shows "Payments are paused, try again soon"; webhook replay |
| ClickHouse | Dashboards go stale | Events wait in the Redis stream (several hours, up to a length cap) and in the apps' queues; gameplay is unaffected |
| Google web ads (v1.1) | No web ad revenue | The web plays ad-free; rewarded lifelines fall back to coins |

## 9. Constraints & assumptions
- Most users are on Android over mobile data with variable 3G/4G and frequent short drops.
- Web push on iPhone only works for web apps added to the Home Screen (iOS 16.4+).
- In-app purchases on Android and iOS must use store billing. Web purchases are separate and never advertised inside the apps.
- No user money is held, so there is no CBN licensing need. Revisit if wallets are ever considered (not planned).
- Hosting outside Nigeria needs an NDPA cross-border transfer basis (standard contractual clauses with AWS). Revisit an in-country option (AWS Lagos Local Zone, or Nigerian DCs such as Rack Centre or MDXi) if the NDPC requires it or latency data supports it.
