# 19 · Build Plan & Progress

**Version:** 1.4 · **Date:** 28 Oct 2026 · *A living checklist: every pull request that finishes part of a step ticks it here*
**Related:** [15 Roadmap](15-roadmap-and-delivery-plan.md) (milestones, sprints, Definition of Done) · [02 PRD](02-PRD.md) (stories and release criteria) · [06 TRD](06-TRD.md) · [09 API](09-API-and-realtime-protocol.md) · [14 Testing](14-testing-and-QA-plan.md) · [18 Admin & Analytics](18-admin-console-and-analytics.md)

---

## 1. How this plan works
- The milestones are the ones in [doc 15 §1](15-roadmap-and-delivery-plan.md): **M1 "First duel"**, **M2 "Feature complete"** and **M3 "Beta"**. This file splits each one into build steps, in the order we build them.
- **One step = one pull request into `main`**, built to the doc sections it lists. A step is done when its boxes are ticked, CI is green (format, lint, typecheck, tests) and the Definition of Done in [doc 15 §6](15-roadmap-and-delivery-plan.md) holds for the parts it touches.
- The next step is broken into detailed boxes; later steps stay at headline level and are detailed when they start, so this file never promises more than we have designed.
- **Third-party services never block a step.** SMS, Google sign-in, push, ads and payments sit behind an interface with a development stand-in; the real provider is plugged in when its account and keys exist (§6).

Status: ✅ done · 🔨 in progress · ⬜ not started

## 2. Already built

| Area | What exists | Where |
|---|---|---|
| Monorepo and CI | pnpm workspaces, Turborepo, TypeScript, ESLint (with the rule that keeps native-only modules out of shared app code, TRD FR-WEB-2), Prettier, Vitest; GitHub Actions runs format, lint, typecheck and tests against real Postgres 16 and Redis 7; `docker compose` for local Postgres, Redis and ClickHouse | repo root, `.github/workflows/ci.yml` |
| Game rules | Scoring, answer timing clamp, xxHash64 and per-player option shuffle, Glicko-2 and tiers, levels and XP, difficulty calibration, content review thresholds, WAT dates and streaks, room codes, the duel state machine and tie-break (73 tests) | `packages/game-rules` |
| API contracts | problem+json errors, guest auth, categories, solo rounds (Zod) | `packages/shared-types` |
| Analytics | The tracking plan as code (doc 13), the PII guard, the client tracker (sessions, foreground time, time per screen, consent, offline queue), server helpers (pseudonymous ids, clock skew, accept-once stream writes) | `packages/analytics` |
| API, first slice | Migrations (schema v1.1) and the seed importer; guest sign-in; ES256 access tokens and rotating refresh tokens with reuse detection, HttpOnly cookie on the web; JWKS; `/v1/me`; `/v1/categories`; the first-run taste test (`/v1/rounds`: one question at a time, server timing, idempotent answers); server analytics events | `apps/api` |
| Ingest | `POST /v1/events`: token check against the API's JWKS, gzip, tracking-plan and consent checks, quarantine, accept-once batches into the Redis stream | `apps/ingest` |

Doc 15 sprint mapping: S0 is done except the Expo skeleton, OTP, Terraform and the web build in CI; S1 is done except the admin console shell, the content module and the ClickHouse loader. Those items are scheduled in the steps below.

## 3. Milestone M1: "First duel" (doc 15, week 8)
**Done when:** two internal users complete a duel against staging, one on an Android phone and one in the web app, and the duel shows on both players' admin timelines.

### Step 1.1 · Duel API ✅
Docs: [GDD §2.1, §3.2, §9](03-game-design-document.md) · [TRD §4.3, §5.1–5.4](06-TRD.md) · [API §2.5](09-API-and-realtime-protocol.md) · [Data model: `duels`, `duel_rounds`, `duel_answers`](08-data-model.md) · [Testing §4.1–4.2](14-testing-and-QA-plan.md) · [Analytics: duel events](13-analytics-and-metrics.md) · [PRD US-3, US-4](02-PRD.md)

- ✅ Contracts for every duel endpoint in `packages/shared-types`
- ✅ `POST /v1/duels` against a friend (`user_id`) or an invite link, with `Idempotency-Key`; at most 20 active duels per player (PRD US-3 AC4)
- ✅ `GET /v1/invites/{token}` (public preview) and `POST /v1/invites/{token}/accept` (binds player B)
- ✅ `GET /v1/duels?state=active|done` with "your turn" first, sorted by deadline; `GET /v1/duels/{id}` (questions only for rounds you finished)
- ✅ `POST /v1/duels/{id}/rounds/{n}/category`: 3 categories offered, picked by A, B, A (GDD §2.1)
- ✅ Round questions: both players get the same 3 (1 easy, 1 medium, 1 by combined rating, GDD §3.2), none the players have seen in the last 30 days where the pool allows
- ✅ Serve and answer one question at a time, same contract as the taste test: per-player option order, timing clamp, raw timing kept in `duel_answers`, answers idempotent per `(duel, round, seq, player)`
- ✅ Turns through the `game-rules` state machine, 48 h turn deadline, running scores
- ✅ Tie-break: one closest-number question; closest guess wins, then the faster answer; a draw if both match or nobody answers
- ✅ Decline, cancel and rematch
- ✅ Expiry as a function the workers call in step 1.3 (`DuelService.expireDue`), and on any request that touches an overdue duel
- ✅ Glicko-2 rating update on completion, stored as `rating_delta_a/b`; gains between the same pair halved for each game past 3 in 24 h (doc 10 §2)
- ✅ Offline tolerance (TRD FR-DUEL-5): an answer re-sent within time limit + 10 s counts, timed at the limit
- ✅ Analytics: `duel_created`, `question_served` and `question_answered` (mode `duel`), `duel_round_played`, `duel_completed` (one per player)
- ✅ Integration tests: every transition including expiry in each state, forfeit winner, the tie-break path; both players answering at once; replayed answers (doc 14 §4.2)

Content: 10 draft `closest_number` questions were added to the seed file for tie-breaks (SEED-0105 to SEED-0114). Like every seed question, they need the fact-check before going live.

Left for later steps, on purpose: friend challenges currently accept any guest or active player's id, and step 1.2 limits them to friends and past opponents; the timing clamp uses a configured RTT until step 1.2 measures it per session; "your turn" pushes come with step 2.5 and reminders with step 1.3; coins, XP and lifelines with step 2.4; category ratings with step 2.1; the void-and-replace of a question after a network drop (GDD §9) with the app in step 1.4; the per-player Redis seen-filters replace the `user_question_seen` table lookup during M3 hardening.

### Step 1.2 · Accounts & friends
Split into two pull requests to keep each reviewable. Docs: [PRD US-2](02-PRD.md), [TRD §4.1, §4.6](06-TRD.md), [API §2.1–2.3](09-API-and-realtime-protocol.md), [doc 10 §1](10-security-anti-cheat-privacy-compliance.md).

#### Step 1.2a · Sign-in ✅
- ✅ Phone codes: Nigerian numbers normalised to E.164 (shared with the apps), 6 digits, 5 minutes, single use, kept only as an HMAC; 5 tries per code, 30 s between sends, 5 a day per number and 10 per device, a per-IP cap
- ✅ SMS: Termii first, Africa's Talking as the fallback, a development stand-in that logs the message; the Android SMS Retriever hash and the web's WebOTP line in the text; a code that could not be sent is not counted
- ✅ Turnstile on web sends, and in the apps from a number's third code of the day (doc 10 §1)
- ✅ Google and Apple sign-in: signature, issuer, audience and expiry checked on the server; Apple's nonce; each method off until its ids are set
- ✅ Guest progress kept (FR-AUTH-4): a guest who signs up becomes the account; a guest who signs in to an existing account has duels, ratings, seen questions, devices and XP moved in, and the link recorded in `user_merges` for analytics
- ✅ A new sign-in method links to the signed-in account (FR-AUTH-8); "Sign out everywhere"
- ✅ Events: `otp_sent`, `otp_verified`, `otp_failed`, `signup_completed`
- ✅ Tests: every rule above against real Postgres and Redis; the SMS adapters' requests and failover

Not in this step: the WhatsApp OTP fallback (PRD US-2, v1.1), contact discovery and age bands (step 1.2b), and the OTP send-to-verify ratio alert (doc 10 §1; the events are in place, the alert comes with the admin alerts in step 2.7).

#### Step 1.2b · Profile & friends ✅
- ✅ `GET`/`PATCH /me`: profile, settings, level progress, rating and tier; usernames chosen once, unique ignoring case, with a starter filter for offensive and official-looking names (EN, Pidgin, Yoruba, Hausa) for moderators to extend
- ✅ The age gate (FR-AUTH-6, doc 10 §3.3): under 13 refused; 13–17 restricted (family mode on, never discoverable), including a guest who answers before signing up
- ✅ Public profile cards (`/users/{username}`)
- ✅ Friends: requests by username or id, accept, decline, unfriend; asking each other at once makes you friends; recent opponents suggested; `friend_added` events
- ✅ Blocks: stop requests, challenges and invite links both ways, without saying who blocked
- ✅ Contact discovery by 20-bit hash prefix (FR-SOC-2): app only, discoverable 18+ accounts only, 500 prefixes a request and 3,000 a day
- ✅ Direct duel challenges limited to friends and past opponents; restricted accounts can be challenged
- ✅ Round-trip sampling (TRD §5.3): server-timed pings, median of the last 5, capped at 1.5 s, used by duel and taste-test timing
- ✅ Tests for each rule, against real Postgres and Redis

Not in this step: guardian consent for 13–17s by guardian phone code (doc 10 §3.3; with the compliance work in step 2.8), reporting players and the moderators' forced rename (with moderation in step 2.7), QR friend codes (with the app in step 1.4).

#### Step 1.2c · Cheaper launch setup ✅
Decided on 28 Oct 2026 to keep running costs down before launch.
- ✅ Phone sign-in can be off: production starts without an SMS provider, both phone endpoints answer `503 PROVIDER_UNAVAILABLE`, and `GET /v1/auth/methods` tells the apps which buttons to show. Launch with guest, Google and Apple; phone comes back by setting the Termii or Africa's Talking keys plus `OTP_SECRET` and `TURNSTILE_SECRET`. Until then "find friends from contacts" finds nobody, so friends come from usernames, invite links, recent opponents and QR codes
- ✅ Sport is the sixth category (migration `0005_sport.sql`; docs 02, 04 and 05), switched off so duels never offer it until approved sport questions are live
- ✅ Mockups of all 32 screens in [`design/`](design/README.md), the reference for step 1.4
- ✅ The [question bank](content/question-bank/README.md): one CSV per category with a source link on every question, an Excel workbook for the team's review, and a checker for the Question Bible rules. Researched sport drafts go in first, and a daily job adds more on the `question-bank` branch
- ✅ Tests: production settings with and without an SMS provider, both phone steps while phone is off, the methods list, and Sport kept out of the category list

### Step 1.3 · Workers & analytics loader ✅
Docs: [07 §4.3](07-system-architecture.md), [08 §3, §6](08-data-model.md), [18 §15](18-admin-console-and-analytics.md), [TRD FR-DUEL-3, FR-NOT-1 to 3](06-TRD.md).

- ✅ A worker process (`apps/api/src/worker.ts`, `pnpm worker`) beside the API, sharing its code. Each job runs on a timer and is safe with several workers at once (locked rows, claimed rows, a Redis lock, a stream consumer group), so no job queue (BullMQ) is needed yet
- ✅ Duel expiry every 30 s through `DuelService.expireDue`, in batches
- ✅ Turn reminders at 24 h and 4 h left, once each per turn (`duel_reminders`), never in quiet hours (22:00–07:00 WAT), in English or Pidgin, naming the opponent and saying whether the duel is lost or cancelled. A stand-in writes them to the log until FCM in step 2.5, and only real pushes record `push_sent`
- ✅ Question stats: `qstat:*` counters added into `question_stats` every minute (plays, right answers, option counts for "Ask Naija", average time), finishing any flush that died halfway
- ✅ Analytics loader into Postgres, decided on 28 Oct 2026 to save cost: `analytics_events` from the Redis stream through a consumer group, each event stored once, bad rows skipped without blocking the rest, entries another loader dropped taken over; hourly daily counts in `analytics_daily` and raw events dropped after `ANALYTICS_RETENTION_DAYS` (60). ClickHouse (`schema/analytics.clickhouse.sql`) comes when daily players reach the thousands, and only the loader changes
- ✅ Tests: each job against real Postgres and Redis, including quiet hours, a failed push tried again, two workers flushing at once, and a loader that died mid-batch

Not in this step: reminders during a tie-break (both players answer, so there is no single turn), the 4-a-day cap on non-turn pushes (FR-NOT-2, with real pushes in step 2.5), and difficulty recalibration from the stats (step 2.6).

### Step 1.4 · The app: Android and web ⬜ (next)
`apps/app` (Expo, Expo Router): design tokens and core components, platform adapters (TRD §5.6), the taste test, sign-in, home with "Your turn" cards, the duel screens, an invite link that opens straight into the turn in the browser, the analytics tracker wired in, web build in CI. Docs: [05 UX](05-UX-and-user-flows.md), [TRD §4.10, §5.6](06-TRD.md), [PRD US-1, US-3, US-4, US-11](02-PRD.md).

### Step 1.5 · Admin console v0 ⬜
`apps/admin` (Next.js): staff sign-in with Google (Google Workspace, or an allow-list of staff Google accounts to save cost), roles, the audit log, player search and User 360 with the activity timeline. Docs: [18 §3, §7, §16](18-admin-console-and-analytics.md), [PRD US-12](02-PRD.md).

### Step 1.6 · Staging ⬜
Heroku in the Europe region, decided on 28 Oct 2026 instead of AWS to save cost: a `Procfile` and `app.json` for the API, ingest, workers, the web app and the admin console, with Heroku Postgres and Heroku Key-Value Store (Redis). Docs: [07 §5](07-system-architecture.md) (its "leaner option"), [TRD §7](06-TRD.md). Needs the team's Heroku account connected to this repo (§6).

## 4. Milestone M2: "Feature complete" (doc 15, week 12)
**Done when:** every P0 story works on Android, iOS and web; the admin console's MVP modules are live (doc 18 §4); 2,000+ approved questions.

| Step | Scope | Main docs |
|---|---|---|
| 2.1 Daily & leaderboards ⬜ | Daily Sabi Challenge, share grid, streaks and freezes, global/state/friends leaderboards, nightly snapshots | PRD US-8, TRD §4.5, §5.5, API §2.6 |
| 2.2 Party rooms ⬜ | `apps/realtime` (Colyseus), party REST side, `apps/web-guest` (Preact party client), host screen mode, Wahala Round | GDD §2.2, TRD §4.4, API §3 |
| 2.3 Random opponents ⬜ | Rating-bucket matchmaking and the labelled Sabi Bot | TRD FR-DUEL-6 |
| 2.4 Economy & monetisation ⬜ | Ledger and coins, lifelines, rewarded ads with SSV, interstitial caps, RevenueCat | GDD §5, TRD §4.7, API §2.8, doc 11 |
| 2.5 Sharing, links & push ⬜ | Share cards, link service (OG previews, deep links), FCM and web push | TRD §4.8, API §4–5, UX §3.3 |
| 2.6 Content tools ⬜ | CMS (CRUD, CSV import with validation), reports and auto-suspend, re-scoring, difficulty recalibration, `valid_until` expiry | TRD §4.2, GDD §6, doc 04, PRD US-9 |
| 2.7 Admin MVP modules ⬜ | Overview, Live, dashboards, Explore and segments, LiveOps (Daily scheduler, config, flags, kill switches), moderation and integrity, support, commerce, compliance, alerts | doc 18 §4–§14, PRD US-13, US-14 |
| 2.8 Platform & compliance ⬜ | Data Saver, Sentry, account deletion and DSAR, guardian consent for 13–17s, iOS build, practice packs offline, PWA | PRD F15, doc 10, TRD §4.10 |

## 5. Milestone M3: "Beta" (doc 15, week 14)
Load tests (doc 14 §5), pen-test fixes, the device and browser matrix including the WhatsApp in-app browser, performance budgets (PRD §8), KPI reconciliation (admin numbers within ±1% of the database), closed track and invite-only web build. Detailed when M2 is close.

## 6. Outside the code
These are for the team, not pull requests, and some steps wait on them.

| Item | Needed by | Notes |
|---|---|---|
| **3,600 approved questions** (≥ 600 in each of the six categories) | M2 (2,000), launch (3,600) | The critical path (doc 15 §5). Today: 114 drafts in the seed file, plus researched drafts in the [question bank](content/question-bank/README.md), none fact-checked yet. A daily job adds drafts; the team checks them in the workbook |
| Google OAuth client IDs (Android, web) | 1.4 | Free in Google Cloud Console; set `GOOGLE_CLIENT_IDS`. The Android client needs the app-signing SHA-1 from Play Console |
| Apple Developer Program and Apple sign-in ids | iOS build (2.8) | US$99 a year; `APPLE_AUDIENCES`. Not needed for Android or the web |
| Expo account (EAS Build) | 1.4 | The free tier builds the Android app; its token goes in CI |
| Heroku account connected to this repo | 1.6 | Europe region. ClickHouse waits until daily players reach the thousands |
| Staff Google accounts for the admin console | 1.5 | Google Workspace, or an allow-list of personal Google accounts |
| Termii sender ID (and Africa's Talking), Turnstile keys | Only when phone sign-in is switched on | Not needed for launch. Registration and NCC approval take weeks. Then set `TERMII_API_KEY`, `TERMII_SENDER_ID` (and `AT_USERNAME`, `AT_API_KEY`), `OTP_SECRET`, `TURNSTILE_SECRET` and the app's `SMS_RETRIEVER_APP_HASH` |
| Firebase project (FCM, web push) | 2.5 | |
| Google Play developer account ✅, AdMob, RevenueCat | 2.4, M4 | The Play account exists. A personal (not organisation) account created after November 2023 must run a closed test with at least 12 testers for 14 days before publishing. AdMob approval takes 2–4 weeks |
| Legal review (NDPA, prizes, ARCON), DPO, DPIA | Before beta | Doc 10 |
