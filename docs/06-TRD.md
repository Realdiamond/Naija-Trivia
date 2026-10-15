# 06 · Technical Requirements Document (TRD)

**Version:** 1.0 · **Date:** 14 Oct 2026
**Related:** [07 Architecture](07-system-architecture.md) · [08 Data Model](08-data-model.md) · [09 API](09-API-and-realtime-protocol.md) · [10 Security & Compliance](10-security-anti-cheat-privacy-compliance.md)

---

## 1. Purpose & scope
This document turns the PRD into technical requirements: the platforms, the stack, functional behaviour of each subsystem, non-functional budgets, and constraints. It is the reference engineers build and test against.

## 2. Platforms & targets
| Platform | Minimum | Reference test devices |
|---|---|---|
| Android | Android 8.0 (API 26), 2 GB RAM supported, 3 GB+ targeted | Tecno Spark 10/20, Infinix Hot 30/40, itel A70/S23, Samsung Galaxy A05/A15, Xiaomi Redmi 12/13C |
| iOS | iOS 15+ | iPhone 8 / SE 2, iPhone 11, iPhone 13 |
| Web (party guest) | Chrome Android 100+, Samsung Internet 20+, Safari 15+, WhatsApp in-app browser | Same devices |
| Admin CMS | Desktop Chrome/Edge/Firefox latest | – |

## 3. Technology stack (decisions)

| Layer | Choice | Why | Rejected alternatives |
|---|---|---|---|
| Mobile app | **React Native + Expo (current stable SDK), TypeScript, Hermes, New Architecture** | One codebase for Android and iOS, shares TS types with the server and web client, OTA updates through EAS Update (instant content and UI fixes without a Play Store review), large Nigerian dev talent pool | Flutter: excellent performance, but a separate language and its web output is too heavy for the guest client. Native Kotlin + Swift: two teams |
| Mobile state | Zustand (UI state), TanStack Query (server cache), MMKV (persistent KV) | Lightweight and fast on low-end phones | Redux |
| Web guest client | **Preact + Vite**, PWA, ≤ 150 KB gzipped | Loads fast over 3G inside the WhatsApp browser | Next.js (too heavy for this job) |
| Admin CMS | **Next.js + shadcn/ui** (internal), deployed behind SSO | Rich forms, tables and auth | Retool (licence cost, but OK for v0) |
| API | **Node.js 22 LTS + Fastify + TypeScript**, Zod schemas → OpenAPI | Fast, typed, one language end-to-end | NestJS (heavier) |
| Realtime | **Colyseus** (Node) for Party Rooms, WebSocket transport, Redis presence/driver | Built for room-based multiplayer, handles reconnection and state sync, scales horizontally with Redis | Socket.IO (more custom code to write), Firebase RTDB (cost and anti-cheat), Ably/Pusher (cost per message at scale) |
| Database | **PostgreSQL 16** (managed: AWS RDS) | Relational integrity for duels, ledger and content. JSONB where flexible | MongoDB |
| Cache, leaderboards, queues | **Redis 7** (ElastiCache). Sorted sets for leaderboards. **BullMQ** for jobs | One dependency covers several needs | Kafka (overkill) |
| Object storage / CDN | S3 + **CloudFront** (Lagos edge) | Images and audio close to users | – |
| Auth | Own auth service: phone OTP (Termii primary, Africa's Talking fallback) + Google Sign-In + Apple Sign-In (iOS). JWT access (15 min) + rotating refresh (30 days) | Local SMS routes cost about ₦8–12 per OTP. Full control of the guest-to-account merge | Firebase Auth phone (higher per-SMS cost to Nigeria, less control) |
| Push | FCM (Android + iOS through APNs) using expo-notifications | Free and reliable | OneSignal |
| Ads | Google AdMob with mediation (AppLovin, Meta Audience Network, Unity Ads, Liftoff) via `react-native-google-mobile-ads` | Best fill in Nigeria with mediation | IronSource-only |
| IAP / subscriptions | Google Play Billing + StoreKit through **RevenueCat** | Receipt validation, entitlements and webhooks handled for us | Building receipt validation ourselves |
| Analytics | **PostHog** (EU cloud) + Firebase Analytics (for the AdMob/Ads link) | Product analytics, funnels, feature flags, A/B | Amplitude (cost) |
| Crash / perf | Sentry (RN + Node) | Source maps, release health | Crashlytics (also acceptable) |
| Remote config / flags | PostHog feature flags + a server `config` table | Tune the economy without a release | – |
| IaC / CI | Terraform, GitHub Actions, EAS Build | Reproducible environments | – |
| Airtime rewards (v2) | Reloadly or VTpass API | Instant sponsor payouts | Manual payout |

## 4. Functional requirements

### 4.1 Identity & accounts
- **FR-AUTH-1:** Guest account created on first launch (`device_id` + server-issued guest JWT).
- **FR-AUTH-2:** Phone OTP. E.164 normalisation (+234), 6-digit code, TTL 5 min, max 5 sends/day/number, max 10/day/device, max 5 verify attempts per code. Use the Android SMS Retriever API with an app hash in the SMS text.
- **FR-AUTH-3:** Google / Apple sign-in using ID-token verification on the server.
- **FR-AUTH-4:** Guest-to-account merge keeps the guest's stats, coins and duels. Conflict rule: if the phone already has an account, guest progress is merged into it and coins are added.
- **FR-AUTH-5:** Account deletion completes within 30 days (NDPA right to erasure). Matches are anonymised, not deleted, so opponents' history stays valid.
- **FR-AUTH-6:** Age band captured at signup. Under 13 is blocked. 13–17 sets `restricted=true`.

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
- **FR-DUEL-3:** Turn deadline 48 h. A BullMQ delayed job handles expiry and sends reminder pushes at T-24h and T-4h.
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

  The server never receives or stores the user's contact list. Users can opt out of being discoverable (Settings → Privacy).
- **FR-SOC-3:** Deep links: `https://whosabi.ng/d/{token}` (duel invite), `/r/{CODE}` (party), `/u/{username}` (profile). Android App Links and iOS Universal Links. **Deferred deep links** use the Play Install Referrer API (Android) and a clipboard-free server fingerprint fallback (iOS, short-lived).
- **FR-SOC-4:** Share cards are rendered on device (`react-native-view-shot`), and the link preview uses an OG image rendered server-side (Satori/resvg) and cached on the CDN.

### 4.7 Economy & monetisation
- **FR-ECO-1:** Coins use a **double-entry ledger** (`ledger_entries`). The balance is derived from the ledger and cached. Every grant or spend has an idempotency key.
- **FR-ECO-2:** Rewarded-ad rewards are granted only on AdMob **server-side verification (SSV)** callback, never on a client claim.
- **FR-ECO-3:** IAP: RevenueCat webhooks → entitlement table. The client reads entitlements from our API, not directly.
- **FR-ECO-4:** Purchases never affect prize eligibility. Sponsored-prize events check `event.purchase_independent = true`, and the code path has no access to entitlements.
- **FR-ECO-5:** Remote-configurable prices and rewards.

### 4.8 Notifications
- **FR-NOT-1:** Types: your_turn, duel_expiring, duel_result, friend_joined, daily_live, league_recap, party_invite, content_correction.
- **FR-NOT-2:** Quiet hours 22:00–07:00 WAT (except party invites from friends). Max 4 non-turn pushes a day per user.
- **FR-NOT-3:** Pidgin or English templates, based on the user's language setting.

### 4.9 Admin CMS
- Roles: `writer`, `fact_checker`, `editor`, `moderator`, `liveops`, `admin`, `support`.
- Question CRUD with workflow, CSV import, media upload (auto-converted to WebP/Opus and size-checked), pack builder, Daily scheduler, event/sponsor campaign setup, report queue, user lookup (support), ban/mute, audit log of every admin action.

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

## 6. Non-functional requirements

| Category | Requirement | Measure |
|---|---|---|
| **Performance (app)** | Cold start ≤ 3.0 s p75 on Tecno Spark 10; JS bundle ≤ 4 MB; 60 fps on the question screen (≤ 16 ms frames) on mid devices, ≥ 45 fps on low-end | Sentry perf, Android vitals |
| **App size** | Download ≤ 25 MB (AAB), install ≤ 60 MB | Play Console |
| **Data budget** | Duel ≤ 1 MB with images, ≤ 300 KB in Data Saver; party game (10 Q) ≤ 400 KB; web guest first load ≤ 150 KB gz + ≤ 200 KB per game | Synthetic tests |
| **API latency** | p95 ≤ 250 ms server time for gameplay endpoints; p99 ≤ 600 ms | APM |
| **Realtime** | Broadcast fan-out ≤ 100 ms server-side; Lagos client p95 end-to-end ≤ 400 ms | Synthetic probes from Lagos/Abuja (MTN and Airtel SIMs) |
| **Scalability** | MVP: 5k concurrent live players, 50k duels a day, 100k DAU. Architecture must scale linearly to 1M DAU by adding nodes | k6 load tests |
| **Availability** | 99.5% monthly (MVP), 99.9% from v2. RPO ≤ 5 min, RTO ≤ 1 h | Uptime monitors |
| **Security** | OWASP ASVS L2. TLS 1.2+ everywhere. Secrets in AWS Secrets Manager. Pen test before launch | – |
| **Privacy** | NDPA/GAID: DPIA, consent logs, DSAR within 30 days, data minimisation | DPO sign-off |
| **Observability** | Structured JSON logs, OpenTelemetry traces, RED metrics per endpoint, Grafana dashboards, PagerDuty/Opsgenie on-call | – |
| **Maintainability** | ≥ 70% unit-test coverage on game logic and economy. Contract tests between client and API (Zod/OpenAPI) | CI gates |
| **Localisation** | ICU message format and i18n keys; no hard-coded strings | Lint rule |

## 7. Environments
| Env | Purpose | Data |
|---|---|---|
| `local` | Docker Compose: Postgres, Redis, API, Colyseus, CMS | Seed CSV |
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

## 9. Constraints & assumptions
- Most users are on Android over mobile data with variable 3G/4G and frequent short drops.
- No user money is held, so there is no CBN licensing need. Revisit if wallets are ever considered (not planned).
- Hosting outside Nigeria needs an NDPA cross-border transfer basis (standard contractual clauses with AWS). Revisit an in-country option (AWS Lagos Local Zone, or Nigerian DCs such as Rack Centre or MDXi) if the NDPC requires it or latency data supports it.
