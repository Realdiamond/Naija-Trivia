# 19 · Build Plan & Progress

**Version:** 1.6 · **Date:** 28 Oct 2026 · *A living checklist: every pull request that finishes part of a step ticks it here*
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

Doc 15 sprint mapping: S0 is done (the Expo app and the web build in CI came with step 1.4; Terraform gave way to Heroku in step 1.6); S1 is done except the admin console shell and the content module, which are scheduled in the steps below. The ClickHouse loader became a Postgres loader in step 1.3.

## 3. Milestone M1: "First duel" (doc 15, week 8)
**Done when:** two internal users complete a duel against staging, one on an Android phone and one in the web app, and the duel shows on both players' admin timelines.

**Status (28 Oct 2026):** every code step is done (1.1 to 1.6). What is left is the check itself: the team deploys staging by following [deploy/heroku.md](deploy/heroku.md), then plays one duel with one player on an Android phone (Expo Go, pointed at staging) and one on the web app, and finds it on both timelines in the admin console. The same flow already passes end to end in CI, with both players in browsers.

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

### Step 1.4 · The app: Android and web ✅
`apps/app` (Expo SDK 58, Expo Router), built in three pull requests. Docs: [05 UX](05-UX-and-user-flows.md), [TRD §4.10, §5.6](06-TRD.md), [PRD US-1, US-3, US-4, US-11](02-PRD.md), the [screen designs](design/README.md).

**1.4a · Foundation, taste test and sign-in ✅**
- ✅ The Expo app for Android, iOS and the web from one codebase; the web build is a single-page app (`pnpm --filter @whosabi/app build:web`) with each screen loaded on demand
- ✅ Design tokens, fonts (Nunito, Baloo 2) and core components from the mockups: buttons, fields, the phone-width column centred on wide screens (FR-WEB-4), avatars, line icons, and the question pieces (category pill, progress, timer, answer buttons)
- ✅ Platform adapters (TRD §5.6): key-value storage, the refresh token (Keystore/Keychain on phones, the HttpOnly cookie on the web), Google sign-in and the human check; the lint rule keeps native-only modules in `*.native.ts` files, and React hooks are linted too
- ✅ The API client: problem+json errors, the access token renewed before it runs out and once after a 401, one shared renewal when several requests fail together (the server rotates refresh tokens and treats reuse as theft)
- ✅ English and Pidgin, chosen on the first screen and saved to the player's profile for reminders (FR-NOT-3)
- ✅ First run (UX §2.1): welcome → guest sign-in tied to the device → the taste test (server timing, one RTT sample first, the tab-hidden time on the web, FR-WEB-7) → the result with "Save your progress"
- ✅ Sign-in shows only the methods switched on (`/v1/auth/methods`): phone code with resend countdown and one-time-code autofill, Google on the web through Google Identity Services, and the guest's progress kept (FR-AUTH-4). Native Google sign-in waits for the development build
- ✅ Profile setup: username (chosen once), six starter avatars, the age gate (under 13 refused, 13–17 restricted), optional home state
- ✅ A first home screen (greeting, level, save progress, play again, sign out); the full home comes in 1.4b
- ✅ The analytics tracker wired in: sessions, foreground time and screens, batches sent with the access token, behaviour events held back until the consent banner (1.4c)
- ✅ API fix found by running the app: CORS now allows `PATCH` and `DELETE` (profile edits were blocked in browsers)
- ✅ Tests: the API client (11 unit tests), and Playwright end-to-end tests in CI that build the web app and play it against the real API: a guest plays the taste test, signs up with a phone code, is refused as under 13, picks a username and stays signed in after a reload; a returning guest goes straight home

Known gap: the web app's first load is about 460 KB gzipped against the 350 KB budget (TRD §6). Trimming it (Zod out of the first bundle, lighter navigation) is part of the M3 performance work.

**1.4b · Home and duels ✅**
- ✅ Home (mockup 08): "Your turn" cards with the time left (orange in the last 6 hours), the actions row (party rooms and random opponents marked "soon"), "Waiting on them" and recent results with the rating change. It refreshes on return and every 30 s until push notifications (step 2.5)
- ✅ Start a duel (mockup 09): a duel link for anyone, or a direct challenge to a friend or recent opponent; the request carries an `Idempotency-Key`, so a retry never starts two duels
- ✅ The duel follows the server's `next` action, so a player can leave and pick up exactly where they stopped: pick a category from the three offered (mockup 10), play the round on the shared question screen with each answer keyed for safe retries, the round review with the right answer, both players and the fact (mockup 12), and the waiting screen
- ✅ Sending the link: WhatsApp first, then copy or the share sheet; the challenger can cancel until the opponent has answered anything, and a challenged player can decline before playing
- ✅ The tie-break: one closest-number question with a timer, the answer shown at once, the result when both have answered
- ✅ The result (mockup 13): win, loss, draw, forfeit, declined or cancelled; round by round; the rating change; rematch; review every round
- ✅ Duel links `/d/{token}` (mockup 28): who is challenging, then accept and play as a guest in the browser with no sign-up. Moved here from 1.4c because the two-player test needs it
- ✅ Friends (mockup 23): add by username, accept or decline requests, add recent opponents, challenge a friend
- ✅ Fix: the sign-in screen no longer says sign-in is off when phone codes are on and only Google is missing
- ✅ Tests: unit tests for the time left and answer keys; end-to-end, two players finish a whole duel through a link in two browsers (the tie-break too when the scores are level), and two accounts become friends, one challenges and the other declines

Left for later on purpose: the profile screen and the tab bar (with leagues and the shop in M2), removing friends and blocking from the app (the API has both), lifelines (step 2.4), push notifications and share cards (step 2.5).

**1.4c · Web polish ✅**
- ✅ Computers (from 1024 px): a side navigation (Home, Start a duel, Friends) beside the phone-width column (FR-WEB-4); not on the first-run, sign-in and duel-link pages
- ✅ Keyboard play (FR-WEB-5): 1–4 or A–D answer, Enter continues (on the round review too), Esc opens the leave dialog; the keys show on the answers with a hint below them. Enter on a focused button is left to that button
- ✅ A leave dialog on every question screen (the back arrow or Esc), warning that the question on screen keeps its timer
- ✅ The consent banner on first open (FR-WEB-11): behaviour analytics only with consent. The choice is kept on the device and recorded on the server through the new `POST /v1/me/consents` (doc 09 §2.2): a `consent_records` row per change, so the history stays, and a `consent_changed` event. A new policy version asks again
- ✅ The welcome screen scrolls on short screens, so the banner never hides "I have an account"
- ✅ Tests: the consents endpoint (records kept as history, events, unknown purposes and anonymous requests refused), keys, and an end-to-end run on a 1280 px screen (banner, keys, leave dialog, side navigation)

Left for later on purpose: changing the consent in settings (with the profile and settings screens in M2), the privacy policy and terms pages (after the legal review, doc 10), and the installable PWA (step 2.8).

### Step 1.5 · Admin console v0 ✅
`apps/admin` (Next.js) on top of a new admin API in the core API (`/admin/*`, doc 09 §2.10). Docs: [18 §3, §7, §16](18-admin-console-and-analytics.md), [PRD US-12](02-PRD.md).

- ✅ Staff sign-in with Google through the console's own OAuth client (`ADMIN_GOOGLE_CLIENT_IDS`), for accounts on the staff list (`admin_users`): an allow-list of personal Google accounts works, and `ADMIN_GOOGLE_DOMAIN` restricts it to a Google Workspace domain later. A development-only sign-in by email for local work and tests; production has no such route
- ✅ Staff sessions: a random token kept only as its hash in Redis, ending 12 hours after sign-in (doc 18 §16), held by the console in an HttpOnly cookie and sent from its server only. Player tokens can't open the admin API and staff tokens can't play
- ✅ Roles (doc 18 §3) with permissions checked on the server for every request and read fresh each time, so a removed role stops working at once. Owner, admin, finance and DPO need a second owner's approval, nobody approves their own grant, and the last owner can't be removed. `pnpm --filter @whosabi/api admin:add` adds the first owner
- ✅ The audit log: every sign-in, search, look at a player, reveal and role change, reads included, with the staff member, reason and IP; searchable on its own page and per player ("Admin history")
- ✅ Player search by username, user ID, phone number (exact, its own permission, logged without the number), guest device ID or duel ID; results masked
- ✅ User 360: profile, masked sign-in methods, level, tier and rating, duel record, friends, latest consents, and the activity timeline grouped into sessions, in WAT with UTC on hover. A guest merged into an account shows on that account's timeline (AD-3)
- ✅ Reveal a phone number only with the role and a reason, logged before it is shown (AD-5)
- ✅ Tests: the admin API (9 integration tests: sign-in rules, sessions, permissions, search, User 360 across a merged guest, reveal, four-eyes approval); the timeline wording; and an end-to-end run where a player plays and signs up, the worker loads their events, and staff find them, see the game on the timeline within seconds (AD-1), reveal the number and find it all in the audit log

Left for later on purpose (step 2.7): Overview and Live, analytics dashboards, the other User 360 tabs (sessions and time, matches, money, safety, support), player actions (grants, warnings, bans) and notes, IP allow-lists and signing in again before sensitive actions.

### Step 1.6 · Staging on Heroku ✅
Heroku in the Europe region, decided on 28 Oct 2026 instead of AWS to save cost. Docs: [07 §5](07-system-architecture.md) (its "leaner option"), [TRD §7](06-TRD.md), and the step-by-step [deployment guide](deploy/heroku.md).

- ✅ Two Heroku apps from one repository, told apart by `WHOSABI_APP`: **game** (`web`: the API; `worker`: the worker; migrations in the release phase) and **admin** (`web`: the console). `Procfile`, `app.json` (add-ons, settings and formation for the game app) and `scripts/heroku.mjs` hold it together; `heroku-postbuild` builds only what each app needs
- ✅ The web app is served by the API from the same address (`WEB_APP_DIR`), with long caching for hashed bundles and the app's page for any other path. One address keeps the refresh cookie first-party, which `herokuapp.com` would otherwise block between two apps
- ✅ The event intake runs inside the API (`EVENTS_IN_API`), so there is no ingest app to pay for; the ingest service stays for later and both share the same code
- ✅ Heroku Postgres and Key-Value Store over TLS (`PGSSLMODE=no-verify`, `REDIS_TLS_VERIFY=false`)
- ✅ `pnpm --filter @whosabi/api keys` makes the signing keys and analytics key as a `heroku config:set` command; keys stored with `\n` for line breaks also work
- ✅ Staging can play the draft questions with `SEED_LIVE_ALLOWED=yes` (refused in production otherwise)
- ✅ Rehearsed locally: the Heroku build of both apps, then the release, web and worker processes in production mode. A guest played the taste test on the same-origin web app, stayed signed in after a reload, the event batch was accepted and the worker loaded it; the console signed staff out to its Google sign-in and the API had no development sign-in
- ✅ Tests: the web app from the API (pages, caching, API 404s untouched), events taken by the API, and Redis TLS settings

To do by the team (§6): create the two apps and deploy them by following the [guide](deploy/heroku.md). About US$29 a month at Basic dynos.

## 4. Milestone M2: "Feature complete" (doc 15, week 12)
**Done when:** every P0 story works on Android, iOS and web; the admin console's MVP modules are live (doc 18 §4); 2,000+ approved questions.

Order: 2.1 first, then **2.6 content tools**, moved up because approved questions are the critical path (§6) and the team needs a way to review and publish them, then 2.5 (sharing, then push), then **2.9 staff on the phone** (the owner runs the game from their phone from launch), email sign-in codes, then the rest. Step 2.6b waits until after 2.5: calibration and re-scoring matter once real players are answering.

**Decisions from the owner (28 Oct 2026):**
- Staff tools live in the one app, as a Staff tab only staff see; for now only owners and admins get it.
- On a phone, staff sign in once with their staff Google account (they play as themselves too). The staff session lasts 30 days on that phone, the Staff tab opens with the fingerprint or phone PIN, and the console can sign a phone out.
- Staff alerts by push, day or night, all on by default and each switchable in the Staff tab: problems, every sign-up, and the payment journey (opened the payment screen, started paying, paid).
- Re-scoring a corrected question (2.6b): players who picked the new right answer get its points, nobody loses points, a duel's result changes only if the totals flip, and both players are told.
- Android and the web first; the iPhone app later (2.8).
- Players can also sign in with a code sent to their email (step 2.10).

### Step 2.1 · Daily & leaderboards ✅
PRD US-8, GDD §2.3, TRD §4.5, §5.5, API §2.6.

- ✅ The Daily Sabi Challenge: the same 7 questions for everyone from 00:00 to 23:59 WAT, numbered from #1 by calendar day. One question from each active category, more from the categories again until six, easiest first, then the hardest as the "boss" #7. Live, family-safe questions only (13–17s play the same Daily), none used in a Daily in the last year while the pool has fresh ones (with a warning in the log when it has to reuse)
- ✅ Played through the same serve → answer flow as the taste test (now shared code, `rounds/solo.ts`), once a day, picking up where the player stopped. An answer to a question shown just before midnight still counts
- ✅ The 7th answer records the result, the streak and XP in one transaction, once however often it is retried. Streaks in WAT, with one free freeze a week covering one missed day (FR-DAILY-4). XP per GDD §5.1 (6 of 7 earns 112). Coins come with the economy (2.4), and so does XP for duels
- ✅ The result: score and time, the streak and its freeze, the grid by category, "you sabi pass N% of Naija today", your rank in your state and the state leading the day (at least 3 players), XP, and the share text with squares only (`Who Sabi? #142 6/7 ⏱ 58s 🟩🟩🟩🟥🟩🟩🟩 🔥12 whosabi.ng/daily/142`), plus every question with its answer and fact
- ✅ Leaderboards for today's Daily and for the week (Monday to Sunday WAT): All Naija and your state from Redis sorted sets, friends from Postgres; top 100 plus your own line. Guests and 13–17s appear without a name or avatar on public boards ("Player from Lagos", doc 10 §3.3). A board missing from Redis is rebuilt from `daily_results`
- ✅ Worker jobs: today's Daily, and from 23:00 WAT tomorrow's, picked and locked (FR-DAILY-1); the nightly snapshot of final ranks (`daily_results.rank`, `state_rank`) and each week's standings (`weekly_standings`), each written once however many workers run
- ✅ A guest who signs in to an existing account brings their Dailies and streak along (FR-AUTH-4)
- ✅ The app: the Daily card on Home (mockup 08), the question screen, the result (mockup 16) with WhatsApp, X and copy, and the leaderboards (mockup 22: friends, my state, All Naija; this week or today). `whosabi.ng/daily/{n}` shows a player their result and sends anyone else, signed in or not, into today's Daily. Daily and Leaderboards join the side navigation on computers
- ✅ Admin: the Daily events read in plain words on a player's timeline
- ✅ Tests: the rules (picking, streaks and freezes, grid and share text, XP, board order); the API against real Postgres and Redis (one Daily for everyone, once only, result and XP, percentile, state ranks and the leading state, boards and hidden names, friends, rebuilding a lost board, streak days with the freeze, the week's total, a merged guest, both worker jobs, too few questions); end to end, a guest plays the Daily from Home, shares the grid, finds themselves on the boards, and a friend opening the link lands in today's Daily

### Step 2.6a · Content tools: the CMS, import and reports ✅
TRD §4.2, doc 04 §3–4, doc 18 §12, PRD US-9. Step 2.6 is split in two: this part gets questions reviewed and live; calibration and re-scoring follow in 2.6b.

- ✅ The Question Bible's format rules in one place (`checkQuestion` in game-rules, the same rules as the question bank's checker): lengths, four different options with the right one marked, a number for closest-number questions, a date for "As of" questions, a region, and a source link before review
- ✅ The workflow (doc 04 §3): writers draft and send for review, a fact-checker (never the writer) approves or sends back with a note, an editor publishes, suspends, retires or reopens. Writers see only their own questions. New permissions `content.view`, `.write`, `.review`, `.publish`, `.import` for the writer, fact-checker and editor roles (owners and admins have them all)
- ✅ Every change in `question_history` (an edit keeps the content before it, as a new version) and in the audit log. A changed answer on a live question is noted; re-scoring the games already played comes in 2.6b
- ✅ The console: Questions (by status with counts, category and text filters, batch publish for approved ones), the editor with live character counts, the right answer marked and the checks, how each question plays (plays, % right, average time, picks per option, open reports), look-alikes (trigram similarity above 70%) and the history; Import; Reports. Sign-in now lands each person on the first section their roles open
- ✅ CSV import (FR-CON-6): a seed or question-bank file, checked first without saving, then imported. Rows approved in the question bank arrive approved (or live, if the editor says so), the rest in review, rejected rows and copies skipped, rows with errors listed by line. Imported questions have no writer, so whoever imports them may check them. The real `sport.csv` (158 questions) checks clean
- ✅ Player reports (PRD US-9, mockup 27): "Report this question" under every answer, a reason in one tap and an optional note; once per player and question, 30 an hour. Five "wrong answer" reports, or reports on more than 3% of plays from 100 plays, suspend the question at once. Editors close the reports: fixed or nothing wrong (it goes back live), or retired
- ✅ The worker retires questions past their "valid until" date every hour, with a line in their history
- ✅ Tests: the rules; the API (10 integration tests: the three-person workflow, writers' limits, sending back, editing live questions, import with every kind of row, batch publishing, both report thresholds, resolving, expiry); end to end, a writer drafts and an editor publishes, imports and clears a reported question in the console, and a player reports a question in two taps
- ✅ Fix: the duel end-to-end test now handles a level score, where the tie-break's last player is left on its reveal

### Step 2.5a · Share pictures, link previews and app links ✅
TRD §4.8, API §5, UX §3.3, mockup 14. Step 2.5 is split in two: this part makes shared links and results look good; push notifications follow in 2.5b.

- ✅ Link previews: every page of the web app carries its own Open Graph tags, added by the API that serves it. A duel link shows who sent the challenge, a Daily link its number, any other page the game's own card. Guests and 13–17s are never named ("Someone")
- ✅ The pictures, drawn on the server with the game's fonts (Satori and resvg): previews at 1200×630 (about 45 KB, WhatsApp's limit is 300 KB), and Status pictures at 1080×1920 with the green-and-orange band, a QR code to the game, and a line in Pidgin: "tolu don school ada for Food", the round won by the most, "Think you sabi pass tolu?". The Daily picture shows the score, time, the coloured squares by category, the streak and "Sabi pass 83% of Naija today", never the answers. About a fifth of a second each, and recent ones are kept in memory
- ✅ Who may see what: preview pictures only for invites and Dailies that exist, rate-limited per IP; Status pictures only for the players in the duel or Daily, once it is over
- ✅ The app: **Share picture for Status** on the duel result and the Daily result. On a phone the picture goes to the share sheet (WhatsApp Status, Instagram and the rest); in a browser it uses the share sheet where the browser can share files, or downloads it. Counted as `invite_shared` and `daily_shared` with the `status` channel
- ✅ App links: the API serves `/.well-known/assetlinks.json` (Android, from `ANDROID_CERT_SHA256`) and `apple-app-site-association` (iOS, from `APPLE_TEAM_ID`); the app claims `/d/`, `/duel/` and `/daily/` links on its domain (`LINK_HOST`, default `whosabi.ng`), so they open the installed app, which routes them like the web app does
- ✅ Tests: the API (previews with and without names, escaping, the pictures' sizes and headers, who may fetch each, names on the duel picture for active, guest and 13–17 players, captions for every outcome, both app-link files with and without settings); the client's picture download and token refresh; end to end, both players download the duel picture and a Daily player downloads theirs

### Step 2.5b · Push notifications: the pipeline and Android ✅
TRD §4.8 (FR-NOT-1 to 3), API §2.2 and §4, doc 05 §4. Web push follows in 2.5c.

- ✅ Phones: the app registers its FCM token (`POST /v1/me/devices`) on every start once pushes are allowed, and forgets it on sign-out. A token moves to whoever signs in on that phone; a player keeps their 10 newest. Guests get pushes too
- ✅ Every push is queued in `push_outbox` in the same transaction as the move that causes it, so none goes out for a move that failed, and the worker sends it within seconds:
  - quiet hours (22:00–07:00 WAT) hold it until 07:00
  - pushes not about a turn stop at four a player a day
  - a newer push about the same duel, friend or Daily replaces a waiting one; a player's waiting push about a duel goes once they play it
  - one past its time (the end of the turn) is dropped
  - dead tokens are forgotten, a busy push service is tried again up to five times, and only real pushes count as `push_sent`
- ✅ What sends what, in English or Pidgin by the player's language (doc 05 §4): "Tolu don challenge you! 🔥" after a direct challenger's first turn, "your turn", the tie-break, the 24 h and 4 h reminders (now through the same queue), the result to whoever didn't end the duel (or both, when time runs out), friend requests and acceptances, and "Daily #142 is live" at 09:00 WAT for players who played in the last week and not yet today, with their streak
- ✅ FCM HTTP v1 from the worker, signed in with the Firebase service account (`FIREBASE_SERVICE_ACCOUNT`); without it, pushes go to the worker's log as before. Android channels (Duels, Friends, Daily challenge) let players switch each kind off in Settings
- ✅ The app (Android): asks at the right moment, not on first open (a card after playing a turn, "we'll tell you the moment Chidi plays", and after the Daily), then the system prompt. Pushes show while the app is open and refresh what is on screen; a tap opens the duel, Friends or the Daily, also from a cold start. `push_received` and `push_opened` are counted
- ✅ Tests: the API (16: registering phones, what each duel move, friend request and the Daily queue, quiet hours, the cap, expiry, collapsing, dead tokens, refusals and retries, a guest's pushes moving to their account, the wording, and the FCM sign-in and message against a stand-in for Google); the reminder tests rewritten on the queue; settings; the app's push routing

### Step 2.5c · Web push ✅
TRD FR-NOT-4 and FR-NOT-5, API §2.2 and §4.

- ✅ The standard Web Push protocol, no Firebase SDK in the page: the browser subscribes with our VAPID public key (`GET /v1/push/web-key`), and `POST /v1/me/devices` keeps the subscription, only at the browsers' push services (an endpoint anywhere else is refused, so a request can't point our servers elsewhere)
- ✅ The worker encrypts each push for its browser (RFC 8291, checked against the RFC's worked example) and signs it with the VAPID key (RFC 8292), through the same push job as Android: quiet hours, the daily cap, collapsing (`Topic`), expiry (`TTL`), turns at high `Urgency`, ended subscriptions forgotten and busy push services tried again. Each device goes through its own service (FCM or web push); a service not set up writes to the log
- ✅ The keys script prints `VAPID_PRIVATE_KEY` (and `OTP_SECRET`); development uses a fixed key so the API and the worker agree. Production without the key keeps web push off and the web app asks for nothing
- ✅ The web app: a service worker (`/sw.js`) shows each push with the game's icon and opens its screen, in the open game when there is one; the same prompt cards as Android after a turn or a Daily; a web manifest and icons, so the game can go on the Home Screen
- ✅ iPhone: Safari allows web push only for a game on the Home Screen, so there the prompt cards stay hidden and the notifications screen says how to add it
- ✅ **Notifications** (the bell on Home, and in the side navigation on computers): whether this phone or browser gets them, a button to turn them on or what to do when they are blocked, and a switch for duels, friends and the Daily reminder. The switches are kept on the account (`push_off`) and count on every device; a switched-off push is recorded as `muted`
- ✅ Tests: the API (9: the RFC example, push services only, the encrypted message and the VAPID signature, what each answer means, the public key following from the private one, the key for browsers, subscribing and forgetting, the push job reaching a browser, switched-off kinds), the worker and manifest served fresh, the VAPID settings; end to end, the notifications screen and its switches

### Step 2.9a · Staff on the phone: the Staff tab ✅
doc 18 §16, owner's decisions above.

- ✅ Google sign-in on Android: Google's account picker through Play services, for players too (phone codes stay off until the SMS sender is approved). It needs `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in the Android build and an Android OAuth client for the app's signing certificate (§6)
- ✅ Signing in to the app with Google using an email on the staff list links that player account to the staff member; owners and admins then see a shield on Home (`Me.staff`). Nobody else ever sees it, and players' emails are still not kept
- ✅ Staff tools on the phone: a 30-day session from the same Google sign-in (`POST /admin/auth/phone`), kept in the phone's secure storage; the tab opens only with the fingerprint, face or PIN, and locks when the app leaves the screen. A phone with no screen lock can't sign in. Losing the role, being suspended or being signed out from the console stops the phone at once
- ✅ The Staff tab: players playing now, today so far against yesterday up to the same time (new players, sign-ups, duels started and finished, Daily players), work waiting (reported questions, in review, approved), refreshed every 30 seconds; player lookup with the profile and recent activity in plain words (the console's wording, now shared)
- ✅ The console: **Staff phones** lists phones signed in to staff tools (owners and admins see everyone's) and signs one out
- ✅ Fix: guest sign-in now uses the app's clock like every other sign-in (only tests could tell)
- ✅ Tests: the API (7: who gets the tab, phone sign-in and refusals, 30 days, suspension, demotion and sign-out from the console or the phone, the phone list, live numbers today against yesterday, the permission); end to end in the console, an owner signs a phone out

### Step 2.9b · Staff on the phone: staff alerts ✅
- ✅ Kinds, as the owner asked, all on to start and each switchable in the Staff tab: **problems** (a question suspended by player reports; no Daily for today or tomorrow, once per date; a worker job failing three runs in a row, once per job every 6 hours), **every sign-up** (how they signed up and on what, opening the player), and the **payment journey** (opened the payment screen, started paying, paid), ready for the shop to raise in step 2.4
- ✅ Raised in the same transaction as what caused them, pushed by the worker within seconds to the phones of owners and admins, day or night, on their own Android channel ("Staff alerts", made only on staff phones). Four or more of one kind at once go as one push ("5 new sign-ups 🎉"). Nobody gets a kind they switched off; signed-out, ended and demoted phones get nothing; dead tokens are forgotten and a busy push service is tried again
- ✅ The Staff tab: **Alerts** with the unread count on the button, the list newest first (opening it marks them seen; a sign-up opens the player), and **Alert settings** with a switch for each kind. A tapped alert opens the Staff tab, behind the fingerprint as always
- ✅ Tests: the API (8: a sign-up reaching owners and admins once, grouping, switched-off kinds and phones that may not get alerts, dead tokens and retries, a question suspended by reports, no Daily, the list with unread and seen, the settings, who may use them); the push routing in the app

### Step 2.10 · Email sign-in codes ✅
- ✅ A 6-digit code by email (TRD FR-AUTH-2a), run by the same code service as phone codes: kept only as an HMAC in Redis, 10 minutes, 5 tries, single use, a newer code retires the older one, 30 s between codes, 5 a day per address and 10 per device, the per-IP cap, Turnstile on the web and in the apps from an address's third code of the day. Phone and email codes are kept apart. A code Resend could not send is not counted
- ✅ Sent through Resend (free: 100 a day, 3,000 a month), with the code in the subject so it shows in the notification. On in development (codes go to the log); in production once `RESEND_API_KEY` is set, which then needs `OTP_SECRET` and `TURNSTILE_SECRET` too. `EMAIL_FROM` names the sender
- ✅ An email address is an identity like a phone number (migration 0012): a guest keeps their progress, an account can add it, and a new one raises the "new sign-up" staff alert
- ✅ The app: "Continue with email" wherever the sign-in buttons are, and on the sign-in screen an email form, with a link to switch to the phone number when both are on
- ✅ Staff: email sign-ins show masked (`c•••@gmail.com`); the console and the Staff tab find a player by their exact address, for roles that may search by phone number, and the audit log keeps it masked
- ✅ Tests: the API (8: sign-up and sign-in again, a guest keeping progress, expiry and tries and phone codes kept apart, pacing and limits and the human check and refused sends, addresses only, email switched off, staff search, the Resend call) and config; an end-to-end sign-up by email in the browser

### Step 2.6b-1 · Difficulty calibration and quality flags ✅
GDD §6.3, content doc §4, TRD FR-CON-5.

- ✅ Every answer in a duel, a Daily or the taste test moves the question's item rating (`d_rating`): `K × (expected − correct)` with K = 8, against the player's overall rating (guests and new players count as 1500). The change waits in the question's Redis counters and the stats flush applies it, in one transaction with the counts, kept between 800 and 2200. Tie-breaks have no right answer and don't count
- ✅ Once a night from 03:00 WAT (`question-calibration`, once however many workers): a live question with 200 plays or more gets its level 1–5 from its rating's quintile among those questions, once there are at least 50 of them; each change is in its history ("Level 3 → 1 from 250 plays")
- ✅ Flags from 300 plays go into the console's reports queue as reports "from the numbers" (`question_reports.by_numbers`): fewer than 5% right (too hard) or more than 97% (too easy) stay in the game; over half of players picking one wrong option points at a wrong answer key, so that question also comes out of the game, with a staff alert. Each kind is filed once per question, so a question an editor keeps isn't flagged again. Only players' reports count toward auto-suspension
- ✅ The console: the new reasons and history entries, "Taken out automatically" in the queue, and the difficulty rating on the question page
- ✅ Tests: the API (a right answer lowering the rating through the taste test, duel answers recording theirs, levels by quintile once a night and only from 200 plays, the three flags filed once with only the wrong key taken out, an editor keeping it)

### Step 2.6b-2 · Re-scoring corrected answers ✅
TRD FR-CON-7, the owner's rule of 28 Oct 2026.

- ✅ An editor giving a played question (live or suspended) a different right answer among the same options queues a correction in the same transaction, and its history says the games are being re-scored. New options, or a question nobody has played, queue nothing
- ✅ The worker (`rescore`, every minute) takes each correction once, in one transaction, for the games of the last 14 days:
  - **Duels:** each answer that picked the new right answer becomes right, with its points as answered (base and speed; no streak bonus, which would need the round replayed). Nobody loses any: answers right under the old key stay right. A finished duel's result changes only if the totals flip (a draw no longer level counts); a forfeit stays with the player who waited, and ratings are left as they are. Cancelled duels are left alone
  - **Dailies:** each answer is now kept with the result (`daily_results.answers`), so the score, grid and correct count follow; final ranks and the week's standings are ranked again, and the boards in Redis set afresh
  - **Players are told** in one push each (`content_correction`): the points gained, or a duel whose result changed (to both players)
- ✅ The question's history ends with what changed ("4 answers now right, 3 duels (1 with a new result), 1 Daily result; 4 players told"), and the correction keeps it in `result`
- ✅ Tests: the API (duels with a flipped result, one still being played, a forfeit, one older than 14 days and a cancelled one; a finished Daily with its ranks, week and board; the pushes and their words; done once; corrected back with nobody losing anything; new options queueing nothing), and Daily answers kept with the result

### Step 2.6b-3 · Trending questions ✅
GDD §6.2.

- ✅ A **Trending** switch on the question form (`questions.trending`). A trending question leaves the game 90 days after it goes live (published or put back live), unless its own "valid until" date is sooner, through the existing `valid_until` and the nightly expiry. Marking a live question trending starts its 90 days then
- ✅ **Renew for 90 days** on the question page for editors (`POST /admin/questions/{id}/renew`): another 90 days from today, for an approved, live or suspended trending question, in its history and the audit log. A retired one is reopened first, like any other
- ✅ The question page shows "Trending · in the game until …"
- ✅ Tests: the API (90 days from going live, a sooner date kept, non-trending ones untouched, renewing as an editor only and only trending ones, expiry after the last day, marking a live question trending) and the date rule in game-rules

### Step 2.2a · Party room server ✅
GDD §2.2, TRD §4.4, API §2.7 and §3. Split in three: the server (2.2a), the app's screens (2.2b) and the light web party client (2.2c).

- ✅ **Plain WebSockets instead of Colyseus** (TRD §2): rooms are small enough to send whole, the browser's own WebSocket keeps the light party client small (the Colyseus client alone is ~69 KB gzipped), and on Heroku one web dyno holds every room anyway. The rooms run inside the API (`src/party`), so the game app stays at one web dyno (deploy guide)
- ✅ The room engine, held in memory: lobby → countdown (3 s) → question → reveal (2.5 s) → top 5 (3 s) → … → podium → play again. The server keeps the clock; each player gets the options in their own order and is timed from when they were sent the question, with the usual round-trip clamp (round trips from WebSocket pings every 15 s, which also keep Heroku from closing the connection)
- ✅ Host settings: 5/10/15/20 questions, 10/15/20 s, packs, family-safe, the **Wahala Round** (the last 3 harder and worth double) and **host screen mode** (the host's screen shows the game and the host doesn't play). Up to 20 players; at least 2 to start. Kick (no coming back), lock, a big screen for a TV (host only)
- ✅ Questions spread across the chosen packs, unseen ones first; a player in family mode keeps the room family-safe. The packs must have enough questions, or the host is told to pick more
- ✅ Reconnection on the same seat token; a dropped player keeps their points and their question. A host gone a minute hands over to whoever has been there longest; a quiet room closes after 10 minutes and its code isn't reused for 10 more (codes reserved in Redis)
- ✅ The podium ranks by points, then right answers, then the quickest right answer, and names the **MVP of the night** (most right, then quickest). The game is saved (`party_games`, `party_results` with names and how each joined), signed-in players get XP (+10 a right answer, +2 a wrong one, +50 for finishing), and answers feed question stats and calibration
- ✅ REST: make a room, the public card behind `/r/{CODE}`, take a seat (signed in, or a web guest with a nickname checked like usernames), a game's results. Seat tokens are 12-hour JWTs for one room's socket only
- ✅ Analytics: `party_room_created`, `party_joined`, `question_answered` (mode party) and `party_game_completed` for signed-in players
- ✅ Tests: the rules in game-rules (Wahala Round, ranking, MVP, XP); the engine with a hand-moved clock (a whole game with the Wahala Round, two players and enough questions to start, a dropped player and a newcomer, host handover and players leaving the lobby, kick, lock, a full room, repeated names, host screen mode, closing when quiet); the API over a real WebSocket (a host and a web guest play a whole game, saved with XP, results, bad seats, the big screen)

### Step 2.2b · Party screens in the app ✅
UX §2.3, mockups 17–20 and 29.

- ✅ **Party room** on Home opens **New party room** (mockup 17): packs (all to begin with), 5/10/15/20 questions, 10/15/20 s, family-safe, the Wahala Round, and "I play too" (off is host screen mode). A guest with no username gives a nickname. "Have a code? Join a room" takes a typed code
- ✅ **The link** `whosabi.ng/r/{CODE}` (mockup 29): whose party, who is in, and a nickname for anyone not signed in (no app, no sign-up); a signed-in player joins as themselves. The link preview on WhatsApp says it is a party
- ✅ **The lobby** (mockup 18): the code big, the link, a QR code (`/party/rooms/{code}/qr.svg`), Share to WhatsApp and Copy link, who is in and how they joined; the host locks the room, removes people and starts once two are in
- ✅ **The game**: 3-2-1, each question on the room's clock (the app keeps the server's time from a few clock samples), the Wahala Round's orange band and points ×2, "Locked in", then the answer with what everyone picked, your points, the fact and the top 5 with who moved up (mockup 19). A newcomer waits for the next question; a big screen or a host in screen mode sees it all without answering
- ✅ **The podium** (mockup 20): the top three, the MVP of the night, everyone else, Share the result, and Play again for the host
- ✅ The room's WebSocket in the app: reconnects after a drop (0.5 s, 1 s, 2 s … for a minute) on the same seat, kept for the session (through a reload on the web); kicked, closed, full or opened elsewhere ends it with a message
- ✅ Tests: the socket's reconnecting and clock; the browser (a guest host and a web guest with just a nickname play a 5-question game, the Wahala Round included, to the podium and back to the lobby); the API's room link and QR code

### Step 2.2c · The light web party client ✅
TRD §2 and FR-SOC-3, UX §1, mockup 29.

- ✅ **`apps/web-guest`**: Preact and Vite, about **15 KB gzipped** (13 KB of script and 2 KB of styles) against a budget of 150 KB, so a party link loads fast over 3G inside WhatsApp's browser. It loads no fonts or images: the phone's own font, and initials for players
- ✅ **What `whosabi.ng/r/{CODE}` opens in a browser**: the API serves the light client for party links (`/party-client/`, its files cached for a year) and the full web app for everything else. `?app=1` opens the room in the full web app instead; the light client's "Have an account? Sign in to keep your score" goes there, so a signed-in player joins as themselves. The link preview on WhatsApp is the same as before
- ✅ The same game as the app, for a guest: whose party and who is in, a nickname (no app, no sign-up), the lobby, 3-2-1, each question on the room's clock with the Wahala Round's band, the answer with what everyone picked and the top 5, and the podium with the MVP and Share the result. Then **Get the app** (Google Play) or **Keep playing in your browser** (the full web app). Kicked, closed, full or opened elsewhere ends it with a message
- ✅ **`packages/party-client`**: the room's WebSocket (reconnecting on the same seat, the server's clock) and what the screens show, now shared by the app and the light client. The seat is kept for the session under the same key, so a reload returns to the game. The light client imports only types from shared-types (`@whosabi/shared-types/party-protocol` and `/routes`), which keeps the validation library out of its bundle
- ✅ Heroku builds it with the web app (`WEB_GUEST_DIR`, deploy guide); CI builds it for the browser tests
- ✅ Tests: the API (party links get the light client unless `?app`, other paths the web app, its files and caching); the browser (a guest opens the link in the light client, gives a nickname, plays a 5-question game with the Wahala Round to the podium, and a reload returns to the podium)

### Step 2.3 · Random opponents and the Sabi Bot ✅
TRD FR-DUEL-6, GDD §2.1.

- ✅ **Random opponent** on Home (`POST /v1/duels {opponent: {random: true}}`): the player takes the seat in a waiting random duel whose challenger is within ±200 rating, widening by 100 every 10 s of that duel's wait; duels they can play at once (the challenger has played round 1) go first, then the longest waiting. Nobody meets someone they blocked or are already playing. With no match, they start a random duel of their own and play round 1 while it waits
- ✅ The pool is the `duels` table itself (random duels with no second player, a partial index), not a Redis queue: one transaction seats the player, and `FOR UPDATE SKIP LOCKED` means two players never take one seat
- ✅ **The Sabi Bot**: after 60 s with nobody, the worker (`sabi-bot-seats`, every 5 s) seats the bot, a user of its own (`users.status = 'bot'`, so no list of players shows it) and the duel's source becomes `bot`. `sabi-bot-turns` plays its turns and tie-break guesses 20 s after they start: it picks categories at random, answers like a player of its opponent's rating (each answer right with the item-rating odds, in 3–12 s), and guesses tie-breaks near the answer
- ✅ Duels with the bot are unrated; it gets no pushes, analytics events, question stats or seen questions, can't be challenged directly and plays no rematches (the result screen offers a new random opponent instead). The app names it "Sabi Bot" and says what it is on the waiting and result screens
- ✅ The app: "Finding you an opponent" while a random duel waits (checked every 5 s), "{name} is playing round 1" for a player seated before the challenger finished, and no decline screen for a random duel
- ✅ Tests: the window and the bot's play in game-rules; the API (pairing, the widening window, blocks and duels already going, the bot seated after a minute and playing late, unrated, without pushes or events, a tie-break it loses, no direct challenge or rematch); the browser (two players meet through Random opponent)

### Step 2.4a · Coins and the ledger ✅
GDD §5.1, TRD FR-ECO-1, API §2.8, doc 08 "Ledger". Step 2.4 is split in four: coins (2.4a), lifelines (2.4b), ads (2.4c) and the shop with coin packs (2.4d).

- ✅ **The ledger** (`src/economy`): every coin movement is one transaction of entries that sum to zero, written once per idempotency key in the game's own database transaction. Grants come from `system:rewards:coins`, spends go to `system:shop:coins`; a player's balance is cached on their account and can't go below zero (spending more is `409 NOT_ENOUGH_COINS`). The system accounts keep no cached balance, so grants never queue on one row
- ✅ **What pays** (amounts from the remote-config defaults): a duel **+30 for a win, +10 for a loss or a draw**, nothing for a forfeit; the **Daily +20, +5 for each streak day after the first, up to +50** (a week's streak); **+100 for each level reached**, whatever the XP came from. The Sabi Bot and deleted accounts earn nothing
- ✅ **XP for duels** (left for this step by 2.1): +10 a right answer and +2 a wrong one in rounds 1–3, and +50 for seeing the duel through; a player who forfeits keeps what their answers earned. Duels keep what each player got (`coins_a/b`, `xp_a/b`) for the result screen
- ✅ Re-scoring (2.6b-2): a new winner after a correction gets the rest of a win's coins; the old winner keeps theirs
- ✅ A guest who signs in to an account brings their coins, as one `merge` transaction. Levels the added XP reaches pay no coins
- ✅ **`GET /v1/wallet`** and **`GET /v1/wallet/history`** (newest first, 30 a page); `coins_changed` analytics events for every coin earned
- ✅ **The nightly check** (`ledger-check`, 04:00 WAT): adds every player's entries up again and checks each transaction balances; anything off is a problem alert to owners and admins (step 2.9b), and nothing is corrected automatically
- ✅ The app: coins on Home (mockup 08) open the **Coins** screen (balance, how to earn, the history); the duel result shows rating, coins and XP side by side (mockup 13); the Daily result shows "+20 coins · +80 XP"
- ✅ Tests: the rules in game-rules (duel and Daily coins, level-ups, duel XP); the API (a win and a loss paid once with XP and events, a level-up's 100, a forfeit, grants once per key, spends only what a player has, a guest's coins following them, the nightly check and its alert, the history's pages, a re-scored duel's new winner, the Daily's coins over a streak); the browser (coins after the Daily and a duel, on Home and the Coins screen)

### Step 2.4b · Lifelines ✅
GDD §5.2, API §2.5, mockup 11.

- ✅ **The four lifelines in duels**, one of each per duel, under the question (rounds 1–3): **50/50** (60 coins) takes two wrong options away; **Ask Naija** (80) shows the share of players who picked each option; **Skip** (100) swaps in another question of the same category and type, unseen if possible, with its own clock; **+10s** (40) gives 10 seconds more, while speed points still count against the usual 15
- ✅ `POST /v1/duels/{id}/lifelines`: the server checks it is the player's question, unanswered and still in time, takes the coins and applies the lifeline in one transaction (no coins, no effect). The same request again gives the same at no charge; a second use is `LIFELINE_USED`. Never in the tie-break or the Daily, and nothing a lifeline does reaches the opponent's screen
- ✅ **Ask Naija** uses everyone's answers to the question so far (`question_stats.option_counts`); while a question is new, an imagined crowd of 20 average players (right as often as its difficulty says) fills in. That crowd always leans, if narrowly, to the right answer, so Ask Naija can't be read backwards
- ✅ After Skip, the round review shows each player their own question, and doesn't compare the two players on it
- ✅ A served duel question carries its lifelines (`used`, and what 50/50 and Ask Naija show), so a reload keeps them
- ✅ The app: the lifeline row on the duel question (mockup 11) with each cost, "Used", and the coins left; 50/50's options fade, Ask Naija's shares show on the options, +10s stretches the timer and Skip's question starts its own
- ✅ Analytics: `lifeline_used`, `coins_changed` and `question_answered.lifeline`
- Left for later: lifelines in party rooms (two a game in GDD §5.2: web guests have no coins, and the room runs on its own clock) and paying for 50/50 with a rewarded ad (step 2.4c)
- ✅ Tests: the rules (costs, 50/50 always the same two wrong options, Ask Naija adding up to 100 and leaning right); the API (each lifeline's effect and price, a free retry, once a duel, not enough coins changing nothing, not once answered, after time or out of turn, Extra Time's late answer with base points only, Skip's new question answered and in the review); the browser (the lifeline row under a duel question, off without coins)

### Step 2.4c · Ads ✅
TRD FR-ECO-2, doc 11 §2, API §2.8, PRD US-10.

- ✅ **Rewarded videos pay 25 coins**, up to 10 a WAT day, from **Watch a video** on the Coins screen (phones; the web plays ad-free until v1.1). The coins come only from **AdMob's server-side verification**: `GET /v1/ads/ssv` checks Google's ECDSA signature against its published keys, pays the player named in the callback once per transaction, keeps every callback in `ad_rewards` (paid or over the cap), and answers 200 so Google stops retrying. The app looks at the wallet again for a few seconds after the video
- ✅ **Interstitials after every 3rd finished duel**, never in a player's first session on the device and never during a question: one is loaded on the result screen when due and shown as the player leaves it (Home or Rematch). Counted on the device; a duel counts once however often its result is opened. The Sabi Pass (v1.1) will switch them off
- ✅ Every request is for non-personalised ads (the consent banner promises no ad tracking) rated PG; gambling and betting are blocked in AdMob as well (doc 11 §7, deploy guide)
- ✅ AdMob in the Android build (`react-native-google-mobile-ads`): `ADMOB_ANDROID_APP_ID` and the two ad unit ids; without them, Google's test ads (which never pay)
- ✅ Analytics: `ad_requested`, `ad_shown`, `ad_reward_granted`, `coins_changed`
- Left for later: paying for 50/50 with a video (a video can't play during a question, US-10), the results-screen banner (done with Data Saver in 2.8b), and web ads (v1.1)
- ✅ Tests: the rules (25 coins, 10 a day, every 3rd match, not in the first session or with the pass); the API (a signed callback paying once, Google's retries, tampered or unsigned or unknown-key callbacks refused, the day's cap and the next day, Google's URL check, fetching Google's keys); the app (interstitial pacing on the device)

### Step 2.4d · The shop and coin packs ✅
TRD FR-ECO-3, doc 11 §3, API §2.8, mockup 25; staff alerts from step 2.9b.

- ✅ **The shop** (mockup 25), from **Buy coins** on the Coins screen: the short ad for 25 coins (phones), the four **coin packs** (500 for ₦300, 1,500 for ₦800, 3,500 for ₦1,500, 9,000 for ₦3,500) at the store's own price, and "No cash and no wallet". On the web, buying comes with Paystack (v1.1), and the shop says so
- ✅ **Buying through Google Play and RevenueCat** (`react-native-purchases`): purchases are made under the player's own id, RevenueCat checks the receipt with Play and calls `POST /v1/webhooks/revenuecat` (its `Authorization` header must match `REVENUECAT_WEBHOOK_AUTH`). The server credits the pack's coins once per store transaction (`purchases.store_tx_id`), with the purchase in `purchases`; a refund takes back what is left of them (a balance never goes below zero). The app looks at the wallet again for a few seconds after paying
- ✅ **The payment journey for staff** (the owner's decisions of 28 Oct 2026): opening the shop (`payment_opened`, at most once an hour per player), tapping buy (`payment_started`, once in ten minutes per pack) and the payment going through (`payment_paid`, "Paid ₦800 💰 · ToluSabi bought 1,500 coins on Google Play", saying when it was a test purchase). A payment for a player we don't know is a problem alert, so someone can sort it out
- ✅ Analytics: `store_viewed`, `purchase_started`, `purchase_failed`, `purchase_completed` and `purchase_refunded` (net of the store's 15%, in kobo), `coins_changed`
- Left for later: the once-only starter pack (it comes with an outfit, so with cosmetics), gems, cosmetics and the Sabi Pass (v1.1), web purchases through Paystack (v1.1)
- ✅ Tests: the API (the packs, only RevenueCat's header, a purchase credited once with its staff alert and event, a test purchase, a refund taking back what is left, a payment for an unknown player, what isn't sold, the payment journey's alerts without flooding); the browser (the shop's packs on the web, with buying off)

### Step 2.7a · The console's Overview and Live ✅
Doc 18 §4–§6, mockup 31. Step 2.7 is split by module; this is the first.

- ✅ **Overview**, the console's home (mockup 31): online now by platform; players, new players, sign-ups and matches today against the same time a week ago; minutes per player and the median session (from the app's foreground time); money today (store purchases in Naira, test purchases apart, rewarded ads, coins earned and spent); live party rooms and duels waiting; event ingest delay and backlog; the work waiting (question reports, suspended questions, integrity flags, data requests due within 7 days); problems raised in the last day. Charts: players by hour against last week, players over 30 days, top states, new players by source and top categories. It refreshes every 15 seconds
- ✅ **Live**: players seen in the last 5 minutes (by platform and state), the party rooms open with their players, and the last hour's key events in words that name nobody, every 5 seconds. Moderators, on-call engineers, admins and owners can remove a player from a room or close it, with a reason, in the audit log
- ✅ The daily rollup counts every player across events and platforms (`analytics_daily` rows with `*`), for the 30-day chart once raw events are gone
- ✅ Permissions: `overview.view` for owners, admins, analysts, growth, LiveOps, moderators, engineers and viewers; `live.manage` for owners, admins, moderators and engineers (doc 18 §3). Staff with Overview now land there
- Left for later in 2.7: the platform filter on the Overview, crash-free sessions and API latency (with Sentry, 2.8), the map of players by state, and the other modules
- ✅ Tests: the API (every Overview number against hand-made players, events, purchases, coins, data requests and alerts on a quiet day; the rollup's totals; who is online; the feed naming nobody and only what is new; rooms listed, a player removed and a room closed with reasons, who may); the console in the browser (an owner lands on the Overview; a moderator closes a party room from Live with a reason)

### Step 2.7b · User 360's other tabs and support's actions ✅
Doc 18 §7.2 and §8, mockup 32.

- ✅ **Sessions & time**: every session (start, end, time in front, platform, app version, network), minutes in front each WAT day for 90 days (a session across midnight counts on both days, AD-2), by platform and by area of the app, the average session and the busiest hours
- ✅ **Matches** (duels with the opponent, result, score and coins; Dailies with their grids; party games with the rank), **Money** (coins and gems, every ledger movement, purchases and refunds, ad rewards) and **Devices & consent** (devices with push on or off, sign-in methods masked, consents). A guest merged into the account counts as the same person
- ✅ The summary adds coins and gems, the Daily streak, lifetime spend in Naira, open integrity flags and the number of notes
- ✅ **Support**: staff notes (anyone who can see the player can leave one; never shown to the player) and, for support, admins and owners (`players.support`), with a reason in the audit log: grant coins through the ledger (`admin_grant`; support up to 500 per player per WAT day, admins and owners up to 5,000; more needs the second approver, later), restore a Daily streak that broke in the last 14 days (once every 30 days; one not played since stays alive, one started again joins the lost run), and sign the player out everywhere
- ✅ Each look at a tab is in the audit log (`view_user_tab`)
- ✅ The console works on a phone: one column, the menu and tabs scroll sideways (doc 18 §17)
- ✅ The Overview counts "today so far" up to now and no further (a fix to 2.7a that also keeps the tests apart)
- Left for later in 2.7: the Social and Safety tabs, each duel's questions and answers, time by mode from the server, helpdesk tickets, and moderation (warn, mute, rename, ban) with its own module
- ✅ Tests: game rules (the streak restore); the API (time split at midnight, sessions, areas, platforms and hours; matches, money and devices; notes; grants within each role's daily limit and again the next day; a streak restored both ways, once in 30 days; signing out everywhere; who may); the console in the browser (support leaves a note, grants coins, is stopped at the limit, sees the ledger and signs the player out)

### Step 2.7c · Flags, kill switches and the status banner ✅
Doc 18 §8 and §11, AD-7.

- ✅ **Flags** (`feature_flags`), worked out on the server for each player: off is off for everyone; on applies to everyone without rules, or to players matching any rule (platform, app version at least, a stable share of players by their id). The rules are in `@whosabi/game-rules`
- ✅ **Kill switches**, on until staff switch them off: ads (rewarded videos and the ads between duels), the shop (no packs), and party rooms (no new rooms or seats, `503 FEATURE_OFF`; games already going carry on). Flipping one is announced in the staff alerts
- ✅ **Status banner** on Home, in English or Pidgin ("Party rooms are having issues. Duels still work."), with its history in `config_history`
- ✅ `GET /v1/config`: each API process keeps flags for 10 seconds and the app looks again every 45, so a change reaches every player within a minute (AD-7). Until it answers, kill switches count as on; the server refuses what is off anyway
- ✅ The console's **LiveOps** page for owners, admins, LiveOps and on-call engineers (`liveops.flags`): each flag with who gets it, who changed it last and a form with a reason; the banner put up, changed or taken down with a reason. Everything is in the audit log
- Left for later in 2.7: remote config values with history and rollback, the Daily scheduler, experiments, Home banners and events
- ✅ Tests: game rules (versions, rules, shares of players); the API (the switches as every app sees them; party rooms refused when off, with the audit entry and the staff alert; another API process catching up within 10 seconds; the shop emptied; rollouts by platform, version and share; who may; the banner up and down with its history); the console in the browser (an engineer switches party rooms off and on and puts a banner up); the app in the browser (Home shows the banner and party rooms taking a break)

### Step 2.7d · Moderation and the integrity queue ✅
Doc 18 §8 and §12, doc 10 §2.

- ✅ From User 360's new **Safety** tab, moderators, admins and owners (`players.moderate`), always with a reason: **warn** (the player reads it on Home until they tap OK), **take a username away** (the player picks a new one, told why), **hide from the boards** other players see (they still play and see themselves) and put back, **ban** (1, 7 or 30 days; 90 days or for good need an admin) and lift a ban
- ✅ A ban signs the player out everywhere; signing in again says until when and how to appeal (`help@whosabi.ng`), and a ban with an end lifts itself the next time they try, back to a guest, a 13–17 account or a full account
- ✅ The Safety tab lists the moderation history (with whether the player saw what they were told) and integrity flags with their evidence
- ✅ The **Integrity** page: the nightly checks' flags, riskiest first; a moderator dismisses one or marks it acted on, with a note. Nothing bans anyone automatically
- Left for later: mute (there is nothing players can say yet), reports of players, appeals in the console, and the second moderator's approval for long bans
- ✅ Tests: the API (a warning read once; a username taken away and a new one picked; a player off others' boards but on their own; bans by length and role, signed out, the message on sign-in, a ban ending itself, lifted early; the queue riskiest first, dismissed and acted on, who may); the console in the browser (a moderator warns, bans for a week, lifts it, and is told a ban for good needs an admin); the app in the browser (the warning on Home until read)

### Step 2.7e · The nightly integrity checks ✅
Doc 10 §2, doc 18 §12.

- ✅ Once a night from 04:00 WAT (`jobs/integrity.ts`), over the last 7 days of duel answers, using rules in `@whosabi/game-rules`:
  - **Accuracy against difficulty**: right answers against what the questions' own share of right answers predicts (questions with 50 plays or more), flagged from a z-score of 4; or 95% right on hard questions (fewer than half of players right) at a near-constant speed, the screen-reader or OCR bot pattern
  - **Faked clocks**: the app's time far below what the server saw after the round trip (a median gap of 3 seconds or more)
  - **Searching in another tab** (web): the tab hidden for 2 seconds or more on a quarter of questions, with 20 points more right answers when it was
- ✅ Each finding is a flag in the Integrity queue with its risk score and evidence; a player is flagged for the same thing at most once a week, whatever a moderator decided. New flags raise one staff alert a night. Nothing bans anyone automatically
- Left for later: the Daily's answers, multi-accounting by device, collusion rings, ad reward abuse and the Play Integrity verdict
- ✅ Tests: game rules (each check's thresholds and scores); the API (a bot-like reader, a faked clock and a tab-hider flagged and an honest player not, on the right night only, once a night, once a week, with the staff alert)

### Step 2.7f · The Daily scheduler ✅
Doc 18 §11.

- ✅ The console's **Daily** page for owners, admins and LiveOps (`liveops.daily`): the next 30 days, each with its number, whether it is planned, fixed or open, how many played today's, and its categories from the easiest question to the boss
- ✅ **Plan the next 30 days** in one go, with a reason: every missing Daily is picked as the game would pick it, numbered by calendar day. Days after tomorrow, and tomorrow until 22:00 WAT, stay open; the 23:00 job fixes tomorrow as before
- ✅ **A day's preview**: exactly the seven questions players get (options in the order written, the right one marked, the fact), each with how it has done and when it was last in a Daily. **Swap** any question for one that fits (live, family-safe, in an open category, not already in that Daily; the same category and level first), with a reason in the audit log, until 22:00 WAT the day before
- Left for later in 2.7: experiments, Home banners and events
- ✅ Tests: game rules (the 22:00 cut-off); the API (planning 30 days numbered in order, today fixed and later days open, planning again does nothing; candidates, a swap with its audit entry, refusals for a repeat, a question that doesn't fit, today and tomorrow after 22:00; who may); the console in the browser (LiveOps plans the month and swaps a question)

### Step 2.7g · Remote config: game and economy values ✅
GDD §10, doc 18 §8 and §11, TRD FR-ECO-5.

- ✅ The economy, tunable without a release (the list and bounds are in `@whosabi/game-rules`): coins for a duel won, lost or drawn, the Daily (and its streak steps and most), each level reached and a rewarded video; rewarded videos that pay a day; an ad between games after every so many duels; the four lifeline prices. Timers, scoring, room sizes and the rest stay as written until their screens can take a change mid-game
- ✅ The API and the worker (duels the Sabi Bot finishes, re-scoring) read the values in force through the same 10-second cache as the flags; a stored value outside its bounds is ignored. The apps get the ones they show or use (lifeline prices, rewarded video coins, ad pacing) in `GET /v1/config`
- ✅ The console's LiveOps page for owners, admins and LiveOps (`liveops.config`): each value with its default, bounds and last change; a new value with a reason; **one click back** to the value before the latest change. Every change is in `config_history` and the audit log
- Left for later: changes for one platform, app version or segment, and experiments
- ✅ Tests: game rules (coins and prices from tuned values; every default within its bounds); the API (the list and who may; a change paying at once and reaching the apps, refusals out of range, unknown or unchanged; another process catching up within 10 seconds; rollback and the history; a stored value out of bounds ignored); the console in the browser (LiveOps changes rewarded video coins and rolls it back)

### Step 2.8a · Account deletion and data requests ✅
NDPA 2023, doc 08 §4, doc 10 §6, doc 18 §14. Step 2.8 is split; this is the first.

- ✅ **Settings** in the app (from the gear on Home): language, notifications, family mode, being findable from contacts, a copy of your data, deleting your account and signing out
- ✅ **Download a copy of my data**: one JSON file (profile, sign-in methods, consents, duels, Dailies, party games, coins and gems, purchases, devices, what the team told the player); a download on the web, the share sheet on a phone. Logged as a completed access request
- ✅ **Delete my account**, at once and for good after typing DELETE, in the app and at `/delete-account` on the web (Google Play's rule; a signed-out visitor is told to sign in, or to write to help@whosabi.ng). The profile is cleared; sign-in methods, devices, sessions, friendships, staff notes and analytics events (merged guests' included) are deleted; past games show "Deleted player"; consent records, the ledger, purchases, moderation and the audit log stay for their legal reasons
- ✅ The console's **Data requests** page: support logs a request made by email or the help centre (on User 360's Support tab); the queue shows each one's 30-day due date, overdue in orange; the DPO (and owners) export the data with a reason, or erase the account with a reason and ERASE typed. Everything is audited
- Left for later in 2.8: ClickHouse deletion when it arrives, rectification and objection requests, and the retention jobs
- ✅ Tests: the API (the export's contents and record; deletion: what goes and what stays, signed out, can't come back; the queue, a request logged, exported and erased, who may, all audited); the console in the browser (support logs a request and the DPO erases the account); the app in the browser (a player downloads their data and deletes their account; the web page for a signed-out visitor)

### Step 2.8b · Data Saver ✅
PRD F15, UX §4, TRD FR-WEB-6, doc 11 §2, doc 18 §15.

- ✅ **Data Saver** in Settings, for guests and accounts: automatic until the player chooses, on when the browser sends Save-Data or reports 2G or 3G, or when a phone is on 2G or 3G mobile data. Their choice is kept in their profile (`data_saver`: true, false, or null for automatic) and on the device, so it applies from the first screen; "Let the app decide" hands it back
- ✅ While it's on: ads between games wait for Wi-Fi (a duel without one doesn't count towards the next), the results banner stays away, and analytics go every 2 minutes instead of every 30 seconds. Rewarded videos still play, since the player asks for them. Questions are text-only already (none has a picture yet) and nothing in the app autoplays, so nothing else had to change
- ✅ **The results banner** (left over from step 2.4c): an adaptive AdMob banner under duel and Daily results on phones, non-personalised and rated PG, never in Data Saver and gone when staff switch ads off. `EXPO_PUBLIC_ADMOB_BANNER_UNIT` gives its unit; without it Google's test banner shows
- ✅ **Compression** for everyone: the API sends replies of 1 KB or more Brotli- or gzip-compressed, and the web app's and party client's files get Brotli and gzip copies at build time (6.4 MB of files down to 1.8 MB)
- Left for later: picture questions and their text-only stand-ins (when the first picture questions arrive), and gzipped event batches from the apps
- ✅ Tests: the API (bundles, pages and bigger replies compressed, small ones not; Data Saver back to automatic); the app's rules (when Data Saver is on, what may show); the app in the browser (Data Saver on by itself with Save-Data, switched off and kept in the profile, back to automatic)

| Step | Scope | Main docs |
|---|---|---|
| 2.1 Daily & leaderboards ✅ | Daily Sabi Challenge, share grid, streaks and freezes, global/state/friends leaderboards, nightly snapshots | PRD US-8, TRD §4.5, §5.5, API §2.6 |
| 2.2 Party rooms ✅ (2.2a, 2.2b, 2.2c) | Party room server (WebSockets in the API), party REST side, the app's party screens, `apps/web-guest` (Preact party client), host screen mode, Wahala Round | GDD §2.2, TRD §4.4, API §3 |
| 2.3 Random opponents ✅ | Rating-window matchmaking and the labelled Sabi Bot | TRD FR-DUEL-6 |
| 2.4 Economy & monetisation ✅ (2.4a, 2.4b, 2.4c, 2.4d) | Ledger and coins, lifelines, rewarded ads with SSV, interstitial caps, RevenueCat | GDD §5, TRD §4.7, API §2.8, doc 11 |
| 2.5 Sharing, links & push ✅ (2.5a, 2.5b, 2.5c) | Share cards, link service (OG previews, deep links), FCM and web push | TRD §4.8, API §4–5, UX §3.3 |
| 2.6 Content tools ✅ (2.6a, 2.6b-1, 2.6b-2, 2.6b-3) | CMS (CRUD, CSV import with validation), reports and auto-suspend, re-scoring, difficulty recalibration, `valid_until` expiry | TRD §4.2, GDD §6, doc 04, PRD US-9 |
| 2.7 Admin MVP modules (2.7a ✅, 2.7b ✅, 2.7c ✅, 2.7d ✅, 2.7e ✅, 2.7f ✅, 2.7g ✅) | Overview, Live, dashboards, Explore and segments, LiveOps (Daily scheduler, config, flags, kill switches), moderation and integrity, support, commerce, compliance, alerts | doc 18 §4–§14, PRD US-13, US-14 |
| 2.8 Platform & compliance (2.8a ✅, 2.8b ✅) | Data Saver, Sentry, account deletion and DSAR, guardian consent for 13–17s, iOS build (after the Android launch), practice packs offline, PWA | PRD F15, doc 10, TRD §4.10 |
| 2.9 Staff on the phone ✅ (2.9a, 2.9b) | Native Google sign-in, the Staff tab (live numbers, player lookup), staff alerts by push | doc 18 |
| 2.10 Email sign-in codes ✅ | Codes by email through Resend | TRD §4.1 |

## 5. Milestone M3: "Beta" (doc 15, week 14)
Load tests (doc 14 §5), pen-test fixes, the device and browser matrix including the WhatsApp in-app browser, performance budgets (PRD §8), KPI reconciliation (admin numbers within ±1% of the database), closed track and invite-only web build. Detailed when M2 is close.

## 6. Outside the code
These are for the team, not pull requests, and some steps wait on them.

| Item | Needed by | Notes |
|---|---|---|
| **3,600 approved questions** (≥ 600 in each of the six categories) | M2 (2,000), launch (3,600) | The critical path (doc 15 §5). Today: 114 drafts in the seed file, plus researched drafts in the [question bank](content/question-bank/README.md), none fact-checked yet. A daily job adds drafts; the team checks them in the workbook |
| Google OAuth client IDs (Android, web) | 1.4, and 2.9a for sign-in on Android | Free in Google Cloud Console. A **web** client (its id goes in `GOOGLE_CLIENT_IDS` on the API and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in the app builds) and an **Android** client for package `ng.whosabi.app` with the SHA-1 of the app-signing certificate (Play Console → App integrity), plus one for the upload key while testing. Client ids are not secrets |
| Resend account and a sending domain, Turnstile keys | To switch email sign-in on (2.10 is built) | Free plans. Add the domain's DNS records Resend shows; the API key is a secret and goes into Heroku as `RESEND_API_KEY`. Turnstile (Cloudflare) gives a public site key for the web build and a secret for the API ([deploy guide](deploy/heroku.md#later)) |
| Apple Developer Program and Apple sign-in ids | iOS build (2.8) | US$99 a year; `APPLE_AUDIENCES`. Not needed for Android or the web |
| Expo account (EAS Build) | 1.4 | The free tier builds the Android app; its token goes in CI |
| Heroku account and the two staging apps | 1.6 | Europe region, about US$29 a month; follow [deploy/heroku.md](deploy/heroku.md). ClickHouse waits until daily players reach the thousands |
| Staff Google accounts for the admin console | 1.5 | Google Workspace, or an allow-list of personal Google accounts. Also a Google OAuth web client for the console (`ADMIN_GOOGLE_CLIENT_IDS` on the API, `ADMIN_GOOGLE_CLIENT_ID` on the console) |
| Termii sender ID (and Africa's Talking), Turnstile keys | Only when phone sign-in is switched on | Not needed for launch. Registration and NCC approval take weeks. Then set `TERMII_API_KEY`, `TERMII_SENDER_ID` (and `AT_USERNAME`, `AT_API_KEY`), `OTP_SECRET`, `TURNSTILE_SECRET` and the app's `SMS_RETRIEVER_APP_HASH` |
| Firebase project (FCM) | 2.5b, before the Android build | Free. Add an Android app with package `ng.whosabi.app` and send the developers its `google-services.json` (it identifies the app, not a secret: it goes in the repo). Then **Project settings → Service accounts → Generate new private key**: that file **is** a secret, so it goes straight into the game app's Heroku settings as `FIREBASE_SERVICE_ACCOUNT`, never into chat ([deploy guide](deploy/heroku.md#later)) |
| Play app-signing SHA-256 fingerprint | 2.5a, once the app is on Play | Public, not a secret: Play Console → App integrity → App signing. Set `ANDROID_CERT_SHA256` so links open the installed app ([deploy guide](deploy/heroku.md#later)) |
| Google Play developer account ✅, AdMob, RevenueCat | 2.4, M4 | The Play account exists and is an **organisation** account, so the rule that makes new personal accounts run a closed test with 12 testers for 14 days before publishing does not apply. AdMob approval takes 2–4 weeks: start it now. Then a rewarded unit with server-side verification pointing at `/v1/ads/ssv`, an interstitial unit, and gambling blocked; the app ID and unit IDs are not secrets. RevenueCat (free to start): the four coin packs as consumable products in Play Console, the app's public SDK key for the build, and the webhook with a secret header value that goes only into Heroku ([deploy guide](deploy/heroku.md#later)) |
| Legal review (NDPA, prizes, ARCON), DPO, DPIA | Before beta | Doc 10 |
