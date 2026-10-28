# 09 · API & Realtime Protocol

**Version:** 1.1 · **Date:** 15 Oct 2026 · *1.1 adds web sessions, web payments, event ingest and the admin API*
**Base URL:** `https://api.whosabi.ng/v1` · **Realtime:** `wss://rt.whosabi.ng` (Colyseus)
**Source of truth:** Zod schemas in `packages/shared-types` generate the OpenAPI 3.1 spec (`/v1/openapi.json`) and the TS clients.

---

## 1. Conventions
- **Auth:** `Authorization: Bearer <access JWT>` (ES256, 15 min). Guests get a guest JWT. On the web the access token lives in memory and the refresh token is an HttpOnly cookie (TRD FR-AUTH-7).
- **Client context:** every request carries `X-Platform` (`android`, `ios` or `web`) and `X-Session-Id`, so server events land in the right session in analytics.
- **Idempotency:** every mutating gameplay or economy call takes an `Idempotency-Key` header (UUID v4). The server stores the result for 24 h and replays it on retry.
- **Versioning:** URL major version. Additive changes don't bump it. Clients send `X-App-Version`, and the server can answer `426 Upgrade Required` with a store link.
- **Errors** (RFC 9457 problem+json):
```json
{ "type": "https://whosabi.ng/errors/turn-not-yours", "title": "It is not your turn", "status": 409,
  "code": "TURN_NOT_YOURS", "detail": "Chidi is still playing round 2.", "request_id": "req_01J..." }
```
- **Pagination:** cursor based, `?cursor=…&limit=20`.
- **Time:** ISO-8601 UTC in payloads. The client converts to WAT for display.
- **Rate limits:** `429` with `Retry-After`. Defaults: 60 req/min/user for gameplay, 5 OTP sends/day/number.

## 2. REST endpoints (MVP)

### 2.1 Auth
| Method | Path | Body → Response |
|---|---|---|
| GET | `/auth/methods` | – → `{guest: true, phone, google, apple}`: the sign-in methods switched on, so the apps show only those buttons. Phone is off in production until an SMS provider is set up |
| POST | `/auth/guest` | `{device_id, platform}` → `{access, refresh, user}` |
| POST | `/auth/otp/send` | `{phone, platform, turnstile_token?}` → `{request_id, resend_after_s: 30}`. Nigerian mobile numbers only, in any common format (normalised to +234…). `platform` picks the SMS format (TRD FR-AUTH-2). A Turnstile token is needed on the web, and in the apps from a number's third code of the day (`CAPTCHA_REQUIRED`, `CAPTCHA_FAILED`). Limits: 30 s between codes to a number (`429` with `Retry-After`), 5 codes per number and 10 per device a day (`OTP_LIMIT_REACHED`), and a per-IP hourly cap. A code the SMS providers could not send is not counted (`503 PROVIDER_UNAVAILABLE`), and both phone endpoints answer `503 PROVIDER_UNAVAILABLE` while phone sign-in is off |
| POST | `/auth/otp/verify` | `{request_id, code, merge_guest?: true}` → `{access, refresh, user, is_new, merged_guest}`. A code lasts 5 minutes, allows 5 tries (`OTP_INVALID` says how many are left, then `OTP_TOO_MANY_ATTEMPTS`), works once, and is retired when a newer code is sent (`OTP_EXPIRED`) |
| POST | `/auth/google` | `{id_token, platform, merge_guest?: true}` → same as verify. The server checks the token's signature, issuer, audience (our client ids) and expiry (`ID_TOKEN_INVALID`); `503 PROVIDER_UNAVAILABLE` when Google sign-in is not set up |
| POST | `/auth/apple` | `{identity_token, nonce, platform, merge_guest?: true}` → same as verify. `nonce` is the raw value; the token must carry its SHA-256 |
| POST | `/auth/refresh` | App: `{refresh}` → rotated tokens. Web: no body; the cookie is read and rotated, and `X-Requested-With` plus an allowed `Origin` are required. Reuse → 401 and the whole family revoked |
| POST | `/auth/logout` | – → 204 |
| POST | `/auth/logout-all` | Needs the access token. Revokes every session on every platform ("Sign out everywhere") → 204 |

**Keeping a guest's progress (TRD FR-AUTH-4, FR-AUTH-8).** Send the current session's access token (`Authorization: Bearer`) with a sign-in request and `merge_guest` (default true):
- a guest signing up for the first time becomes the account: same id, nothing moves (`is_new: true, merged_guest: true`);
- a guest signing in to an existing account has their duels, answers, ratings, seen questions, consents, devices and XP moved into it, and the guest is retired (`is_new: false, merged_guest: true`). An unfinished duel between the guest and that same account is cancelled;
- an account signing in with a new method has it linked (e.g. Google added to a phone account).
A token that is sent but expired is a `401` before the code is used, so the app refreshes and retries rather than losing the guest. `merge_guest: false` signs in without touching the current session.

### 2.2 Me & profile
| Method | Path | Notes |
|---|---|---|
| GET | `/me` | Profile, settings, age band, level with XP progress, rating and tier, and `staff` (an owner or admin playing with their staff Google account: the app shows the Staff tab, step 2.9a). Balances, entitlements and flags join with their steps |
| PATCH | `/me` | `{username?, avatar_id?, home_state?, language?, data_saver?, family_mode?, discoverable?}`, all optional. The username needs an account and is chosen once (`USERNAME_LOCKED`; support changes it): 3–20 letters, digits or `_`, unique ignoring case (`USERNAME_TAKEN`), and filtered for offensive and official-looking names (`USERNAME_NOT_ALLOWED`). Restricted (13–17) accounts can't turn family mode off or become discoverable |
| POST | `/me/age` | `{age_band: under_13 | 13_17 | 18_plus}`. One-time (`AGE_ALREADY_SET`; changes go through support). `under_13` is refused (`AGE_NOT_ALLOWED`). `13_17` makes the account restricted (doc 10 §3.3): family mode on, not discoverable; a guest who answers 13–17 becomes a restricted account when they sign up |
| POST | `/me/consents` | `{source: onboarding | settings | web_banner, consents: [{purpose, granted, policy_version}]}`. Purposes: `terms`, `privacy`, `analytics`, `marketing_push`, `ads_personalisation`, `contacts`, `session_replay`. Each change is a new `consent_records` row (the history is kept) and a `consent_changed` event; `204` |
| POST | `/me/devices` | Turns pushes on for this phone: `{platform: android, push_token, app_version?, model?}`; `204`. The app sends it on every start (FCM can change the token), and the token moves to whoever is signed in on the phone. A player keeps their 10 newest phones. 30 an hour. Web push (step 2.5c) and iOS (step 2.8) add their platforms |
| DELETE | `/me/devices` | `{push_token}`: pushes off for this phone (on sign-out); `204` |
| GET | `/me/stats` | Per-category accuracy, best streak, duel W/L |
| POST | `/me/delete` | Starts erasure (30-day SLA); returns a `dsar_id` |
| POST | `/me/export` | DSAR access export (emailed / in-app download link) |
| GET | `/users/{username}` | Public profile card `{id, username, avatar_id, level, tier}`. `404` for unknown players and when either side has blocked the other |
| POST | `/ping` · `/ping/{ping_id}` | Round-trip sampling (TRD §5.3): ask for a ping and answer it at once; the server times both ends and keeps the session's last 5 samples (`X-Session-Id`). Answer timing uses their median, capped at 1.5 s, or the default before any sample |

### 2.3 Social
| Method | Path | Notes |
|---|---|---|
| GET | `/friends` | `{friends, incoming, outgoing, suggested}`: accepted friends, requests both ways, and recent opponents who aren't friends yet (FR-SOC-1) |
| POST | `/friends/requests` | `{user_id}` or `{username}`, with an optional `source` (for analytics) → `201 {status: "pending", user}`. If they had already asked you, you become friends at once (`status: "accepted"`). Asking again is harmless |
| POST | `/friends/requests/{user_id}/accept` · `/decline` | `{user_id}` is the player who asked |
| DELETE | `/friends/{user_id}` | Unfriend, or cancel a request you sent → 204 |
| POST | `/discovery/prefixes` | `{prefixes: ["a1b2c", …]}` (20-bit hex, up to 500 per request and 3,000 a day) → `{matches: [{hash, user_id, username, avatar_id}]}` with the full hashes; the app matches its contacts locally. Only discoverable 18+ accounts are returned. App only (`403` from the web) |
| POST | `/blocks` · DELETE `/blocks/{user_id}` | Block: ends a friendship or request, and stops friend requests, duel challenges and invite links both ways (`USER_UNAVAILABLE`, `OPPONENT_UNAVAILABLE`), without saying who blocked. Only the player who blocked can unblock |

Everything in §2.3 needs an account (`ACCOUNT_REQUIRED`): guests play through invite links. A direct duel challenge (`POST /duels` with `user_id`) goes to friends and past opponents only (`FRIENDS_ONLY`); anyone else gets an invite link.

### 2.4 Content
| Method | Path | Notes |
|---|---|---|
| GET | `/categories` | With localised names and colours |
| GET | `/packs` | Catalogue with access state |
| GET | `/packs/{id}/practice` | 50 questions **with** answers (practice only, no rating), signed URLs for media |
| POST | `/questions/{id}/reports` | `{reason: wrong_answer|outdated|offensive|typo|unfair, note?}` → `202`. Once per player and question (again is still `202`), 30 an hour per player, only for questions players can have seen. Five open "wrong answer" reports, or open reports on more than 3% of plays (from 100 plays), suspend the question at once |
| POST | `/rounds` | `{mode: "taste_test"}` → `{round_id, mode, total, categories}`. The first-run taste test: one easy, family-safe question each from Slang, Food and Music (PRD US-1). Practice and the Daily will use the same round flow |
| POST | `/rounds/{id}/questions/{seq}/serve` · `/answer` | Same contract as duels (§2.5): one question at a time, served time recorded once, answers idempotent |
| GET | `/rounds/{id}` | `{total, answered, correct_count, score, complete, answers[]}` |

### 2.5 Duels
| Method | Path | Notes |
|---|---|---|
| POST | `/duels` | `{opponent: {user_id} | {random: true} | {link: true}}` → `201 {duel, invite_url}`. Takes `Idempotency-Key`. At most 20 duels going per player (`DUEL_LIMIT_REACHED`). `random` arrives with build step 2.3 |
| GET | `/duels?state=active|done&limit&cursor` | List for the home screen: active ones with "your turn" first, soonest deadline first; finished ones newest first, paged by `cursor` |
| GET | `/duels/{id}` | The duel from your side: scores, `next` action, rounds, tie-break. Questions, answers and the opponent's points only for rounds you have finished |
| POST | `/duels/{id}/rounds/{n}/category` | `{category_id}`, one of the 3 offered. Picked by A (rounds 1 and 3) or B (round 2) during their turn → the duel |
| POST | `/duels/{id}/rounds/{n}/questions/{seq}/serve` | → one question (shuffled, no answer), `time_limit_ms`. Serving again returns the same `served_at`. Round 4 is the tie-break: one `closest_number` question with no options |
| POST | `/duels/{id}/rounds/{n}/questions/{seq}/answer` | `{display_index | null, client_elapsed_ms, tab_hidden_ms?}` → `{correct, timed_out, correct_display_index, points, breakdown, fact, running_score, streak, next}`. Round 4 takes `{guess | null, client_elapsed_ms}` → `{guess, timed_out, answer, fact, decided, result}`. A retry gets the first answer back; a different `Idempotency-Key` for an answered question is `409 ALREADY_ANSWERED` |
| POST | `/duels/{id}/lifelines` | `{type: "fifty"|"ask_naija"|"skip"|"time", round, seq}` → effect payload; debits coins (build step 2.4) |
| POST | `/duels/{id}/decline` · `/cancel` | Decline (B) or cancel (A), only before B has been shown a question (`DUEL_ALREADY_STARTED`) → the duel |
| POST | `/duels/{id}/rematch` | After a finished duel. Both players asking at once start one rematch: `201` for the first, `200` with the same duel for the second |
| GET | `/invites/{token}` | Public preview for the link page: `{challenger: {id, username, level}, status: open|taken|closed, expires_at}` |
| POST | `/invites/{token}/accept` | Binds `player_b`. If the challenger has played round 1, B's 48 h start now. Accepting again is fine; anyone else gets `INVITE_TAKEN` |

The `next` action tells the app what to show: `{action: "pick_category", round, offered}`, `{action: "play", round, seq}`, `{action: "tiebreak"}` or `{action: "wait"}` (null once the duel is over). Duel errors: `TURN_NOT_YOURS`, `CATEGORY_NOT_OFFERED`, `CATEGORY_NOT_PICKED`, `QUESTION_NOT_SERVED`, `QUESTION_OUT_OF_ORDER`, `DUEL_FINISHED` (including a turn that just ran out), `DUEL_LIMIT_REACHED`, `OPPONENT_UNAVAILABLE`, `INVITE_TAKEN`, `ALREADY_ANSWERED`, `DUEL_ALREADY_STARTED`. Someone who is not in a duel gets `404`, as if it did not exist.

An answer re-sent after a network drop counts if the device tapped within the time limit and it arrives within the limit + 10 s, scored with no speed bonus (TRD FR-DUEL-5). A tie-break goes to the closer guess, then the faster answer; if only one player answers before the deadline they win, and if neither does it is a draw.

**Example: serve → answer**
```http
POST /v1/duels/d_01J9/rounds/2/questions/1/serve
Idempotency-Key: 7c1e…
```
```json
{ "qid": "q_seed-0024", "seq": 1, "type": "mcq4",
  "text": "Who directed The Wedding Party (2016)?",
  "options": ["Funke Akindele","Kemi Adetiba","Kunle Afolayan","Niyi Akinmolayan"],
  "media": null, "time_limit_ms": 15000, "served_at": "2026-10-14T19:02:11.412Z" }
```
```http
POST /v1/duels/d_01J9/rounds/2/questions/1/answer
{ "display_index": 1, "client_elapsed_ms": 4210 }
```
```json
{ "correct": true, "timed_out": false, "correct_display_index": 1, "points": 172,
  "breakdown": {"base":100,"speed":72,"streak":0},
  "fact": "Niyi Akinmolayan directed the 2017 sequel.", "running_score": 640, "streak": 1,
  "next": {"action": "play", "round": 2, "seq": 2} }
```

### 2.6 Daily and leaderboards
| Method | Path | Notes |
|---|---|---|
| GET | `/daily/today` | `{id, date, total, categories, played, answered, streak: {current, best, freezes_left}, closes_at}`. `id` is the Daily's number (#142); `answered` lets the app pick up where the player stopped. Picks today's Daily if the worker has not yet; `503 NO_QUESTIONS_AVAILABLE` with fewer than 7 live family-safe questions |
| POST | `/daily/{id}/questions/{seq}/serve` · `/answer` | Same contract as the taste test and duels; the answer adds `finished` after the 7th. Today's Daily only (`DAILY_CLOSED` for an earlier one) and once (`DAILY_ALREADY_PLAYED`); an answer to a question shown before midnight still counts just after it |
| GET | `/daily/{id}/result` | `{correct_count, score, total_ms, grid, categories, percentile, players, state: {code, rank, players}, leading_state, streak: {…, used_freeze}, xp, share_text, share_url, review[]}`. `percentile` is the share of the day's other players you beat (null while you are the only one); `review` has each question, its answer and fact. `DAILY_NOT_FINISHED` before the 7th answer |
| GET | `/daily/{id}/leaderboard?scope=global|state|friends` | Top 100 + `me`: `{board, period, scope, state, players, resets_at, entries[], me}`. Each entry: `{rank, kind: player|guest|restricted, username, avatar_id, home_state, level, tier, score, you}`. Guests and 13–17s show no name or avatar on public boards (doc 10 §3.3); friends see each other's names |
| GET | `/leaderboards/week?scope=global|state|friends` | The same for this week's Daily points, Monday to Sunday WAT |

### 2.7 Party (REST side)
| Method | Path | Notes |
|---|---|---|
| POST | `/party/rooms` | `{settings}` → `{room_code, room_id, ws_url, seat_reservation}` |
| POST | `/party/rooms/{code}/join` | App user or web guest `{nickname}` → `{seat_reservation, guest_token?}` |
| GET | `/party/games/{id}` | Results (for share card) |
| POST | `/internal/party-results` | Realtime → API only, HMAC-signed |

### 2.8 Economy & shop
| Method | Path | Notes |
|---|---|---|
| GET | `/wallet` | `{coins, gems}` |
| GET | `/wallet/history` | Ledger view |
| GET | `/shop` | Cosmetics, packs, offers (remote-config priced) |
| POST | `/shop/purchase` | `{item_id, currency}` (coins/gems only; real money goes through the stores) |
| POST | `/inventory/equip` | `{cosmetic_id}` |
| GET | `/ads/ssv` | **AdMob SSV callback** (signature verified with Google's public keys; dedupe by `transaction_id`) |
| POST | `/webhooks/revenuecat` | Entitlement updates (auth header secret) |
| POST | `/payments/paystack/initialize` | Web only (v1.1). `{sku}` → `{authorization_url, access_code, reference}` for Paystack's inline checkout |
| POST | `/webhooks/paystack` | Web purchases (v1.1). Checks the `x-paystack-signature` HMAC-SHA512, verifies the transaction with Paystack's API, then grants through the ledger or entitlements (dedupe by `reference`) |
| POST | `/ads/web/sessions` | Web only (v1.1). `{placement}` → `{ad_session_id}`, single use, valid 1 h |
| POST | `/ads/web/sessions/{id}/complete` | Grants the reward if the session is valid, the minimum view time has passed and the player is under the daily cap (5) |

### 2.9 Leagues (v1.1)
`POST /leagues`, `POST /leagues/join {invite_code}`, `GET /leagues/{id}`, `GET /leagues/{id}/week/{iso}`, `GET /leagues/{id}/recap.png`.

### 2.10 Admin console API (SSO + RBAC)
Served by the core API under `/admin`, only to admin-console sessions (Google Workspace OIDC). Every call is permission-checked on the server and written to `admin_audit_log`, reads included. Each screen is described in [doc 18](18-admin-console-and-analytics.md).

Built so far (step 1.5): `POST /admin/auth/google {id_token}` (the console's own Google client; the account must be on the staff list, and in the Workspace domain when `ADMIN_GOOGLE_DOMAIN` is set) → `{token, expires_at, admin}`, a 12-hour staff session sent as `Authorization: Bearer`; `POST /admin/auth/logout`; `GET /admin/me`; the Players rows below except `/sessions`, `/time`, `/matches` and `/ledger`; `POST /admin/users/{id}/reveal {field: phone, reason}`; `GET /admin/audit?actor=&entity=&entity_id=&before=`; and `/admin/staff` (list, add, `POST /admin/staff/{id}/roles {role, reason, expires_at?}`, `…/roles/{role}/approve`, `DELETE …/roles/{role}`). Outside production, `POST /admin/auth/dev {email}` signs staff in without Google.

Staff on the phone (step 2.9a): `POST /admin/auth/phone {id_token, label}` takes a Google ID token from the app's own sign-in (the game's `GOOGLE_CLIENT_IDS`) and gives owners and admins a 30-day phone session (`aph_…`, only its hash is kept), sent the same way as a console session; others get `403` saying why. `GET /admin/phones` lists signed-in staff phones (owners and admins see everyone's, others their own, `current` marks the asking phone) and `POST /admin/phones/{id}/revoke` signs one out; `POST /admin/auth/logout` from a phone ends its session. `GET /admin/overview` (permission `overview.view`) gives the live numbers: players seen in the last 10 minutes, and today so far (WAT) against yesterday up to the same time for new players, sign-ups, duels started and finished and Daily players, plus questions reported, in review and approved. Outside production, `POST /admin/auth/phone/dev {email, label}`.

The Content module (step 2.6a): `GET /admin/questions?status=&category=&q=&reported=&cursor=` (writers see only their own) · `POST /admin/questions` (a draft) · `GET` and `PUT /admin/questions/{id}` (the detail has live stats, the Question Bible checks, look-alikes, the moves you may make and the history; an edit is a new version) · `POST /admin/questions/{id}/actions {action, note?}` with `submit`, `approve` (never your own), `send_back` (with a note), `publish`, `suspend`, `restore`, `retire`, `reopen` · `POST /admin/questions/publish {ids}` · `POST /admin/questions/import {csv, dry_run, publish_approved}` (seed or question-bank CSV, up to 3 MB) · `GET /admin/reports` · `POST /admin/questions/{id}/reports/resolve {resolution: fixed|rejected|retired, note?}`. Permissions: `content.view`, `content.write`, `content.review`, `content.publish`, `content.import` (doc 18 §3: writer, fact-checker, editor).

| Area | Endpoints |
|---|---|
| Overview & live | `GET /admin/overview` · `GET /admin/live/online?platform=&state=` · `GET /admin/live/rooms` · `GET /admin/live/feed` (server-sent events, PII-free) |
| Players | `GET /admin/users?q=` (search) · `GET /admin/users/{id}` (User 360 summary) · `GET /admin/users/{id}/timeline?from=&to=&types=` · `GET /admin/users/{id}/sessions` · `GET /admin/users/{id}/time` · `GET /admin/users/{id}/matches` · `GET /admin/users/{id}/ledger` · `GET /admin/users/{id}/audit` |
| Player actions | `POST /admin/users/{id}/reveal {field, reason}` · `POST /admin/users/{id}/actions {type, reason, …}` where `type` is `grant_coins`, `restore_streak`, `warn`, `mute`, `rename`, `shadow_restrict`, `ban` or `sign_out` · `POST /admin/users/{id}/notes` |
| Analytics | `GET /admin/analytics/{dashboard}?from=&to=&platform=&segment=…` (server-side query templates) · `POST /admin/segments` · `GET /admin/segments/{id}/count` · `POST /admin/exports {query, reason}` → approval → signed link (24 h) · `GET /admin/metabase/embed/{dashboard}` (signed embed URL) |
| LiveOps | `/admin/daily/{date}` · `/admin/config` (with history and rollback) · `/admin/flags` · `/admin/experiments` · `/admin/banners` · `/admin/events` · `/admin/push-campaigns` (v1.1) · `/admin/alerts` |
| Content | `/admin/questions` (CRUD, workflow transitions, CSV import) · `/admin/media` · `/admin/packs` · `/admin/reports` |
| Safety | `/admin/moderation` · `/admin/integrity` (flags: dismiss or act) · `/admin/appeals` |
| Commerce & sponsors | `/admin/purchases` · `/admin/refunds` · `/admin/reconciliation` · `/admin/sponsors` · `/admin/prize-events` (v2) |
| Compliance & settings | `/admin/dsar` · `/admin/consents` · `/admin/retention` · `/admin/audit` · `/admin/staff` (roles, with four-eyes approval) |

### 2.11 Analytics ingest
The load balancer routes `POST /v1/events` to the ingest service, not the core API.

| Method | Path | Notes |
|---|---|---|
| POST | `/events` | A gzipped batch (≤ 64 KB compressed, ≤ 500 events) → `202 Accepted`. A resent batch (same `batch_id`) also gets `202` and is dropped. Works before sign-in for first-launch events, and from `sendBeacon` on the web |

```json
{ "batch_id": "b_01JA…", "sent_at": "2026-11-02T08:08:00.120Z",
  "context": { "platform": "android", "app_version": "1.0.0", "device_model": "TECNO KI5", "ram_mb": 4096,
               "network_type": "4g", "carrier": "MTN", "language": "en", "data_saver": false, "anon_id": "i_7f3…" },
  "events": [
    { "event_id": "5b0c…", "event": "screen_viewed", "ts": "2026-11-02T08:02:30.000Z", "session_id": "s_01JA…", "seq": 6,
      "screen": "duel.question", "props": { "prev_screen": "home", "prev_screen_ms": 15000 } },
    { "event_id": "9e41…", "event": "app_backgrounded", "ts": "2026-11-02T08:08:00.000Z", "session_id": "s_01JA…", "seq": 7,
      "screen": "duel.question", "props": { "foreground_ms": 480000, "screen": "duel.question", "screen_ms": 330000 } }
  ] }
```
The user comes from the access token when there is one; the client never sends its own user ID.

## 3. Realtime protocol (Party Room, Colyseus)

### 3.1 Connection
1. The client calls `POST /party/rooms/{code}/join` and receives a `seat_reservation`.
2. The client calls `client.consumeSeatReservation(reservation)` and connects to the right node.
3. The server validates the JWT (app) or guest token (web) in `onAuth`.

### 3.2 Room state (Colyseus Schema, synced by delta patches)
```ts
class Player extends Schema {
  @type("string") id; @type("string") name; @type("string") avatar;
  @type("number") score = 0; @type("number") streak = 0;
  @type("boolean") connected = true; @type("boolean") answered = false;
}
class PartyState extends Schema {
  @type("string") phase = "LOBBY";      // LOBBY|COUNTDOWN|QUESTION|REVEAL|LEADERBOARD|PODIUM|CLOSED
  @type("string") hostId;
  @type("number") qIndex = -1; @type("number") qTotal = 10;
  @type("number") endsAt = 0;           // server epoch ms
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("boolean") locked = false;
}
```
The question text and options are **sent as messages, not state**, so late joiners and spectators can't read them early and patches stay small.

### 3.3 Messages
| Direction | Type | Payload |
|---|---|---|
| C→S | `ping` | `{t0}` → S→C `pong {t0, ts}` (clock sync; client keeps the median offset) |
| C→S (host) | `settings` | `{questions, timer_s, packs[], family_safe}` |
| C→S (host) | `start` | – |
| C→S (host) | `kick` | `{playerId}` |
| C→S (host) | `lock` | `{locked}` |
| S→C | `question` | `{index, total, qid, text, options[4], media?, time_limit_ms, ends_at, wahala: bool}` |
| C→S | `answer` | `{qid, display_index, client_elapsed_ms}` (first answer only; later ones are ignored) |
| S→C | `answered_ack` | `{qid}` |
| S→C | `reveal` | `{qid, correct_display_index, distribution[4] (in your display order), your_points, fact}` |
| S→C | `leaderboard` | `{top: [{id,name,score,delta}], you: {rank, score}}` |
| S→C | `podium` | `{top3, mvp, game_id, share_url}` |
| C→S (host) | `play_again` | – |
| S→C | `toast` | `{kind: "joined"|"left"|"host_changed", name}` |

Options are shuffled **per player**, so `reveal` sends each client its own correct display index (a private `client.send`, not a broadcast).

### 3.4 Timing on the server
```
on QUESTION start: endsAt = now + time_limit + 300ms grace
on answer: accepted = clampElapsed(client_elapsed, now - question_sent_at, rtt(client))
on (all answered) or (now >= endsAt): score all, phase = REVEAL (2.5 s) → LEADERBOARD (3 s) → next
```

### 3.5 Close codes
| Code | Meaning | Client action |
|---|---|---|
| 4000 | Room closed / ended | Show results or exit |
| 4001 | Kicked | Show message, don't auto-rejoin |
| 4003 | Auth failed | Re-auth and retry once |
| 4004 | Room full or locked | Show message |
| 1006 (abnormal) | Network drop | Auto-reconnect with backoff 0.5 s, 1 s, 2 s, 4 s… up to 60 s using the reconnection token |

## 4. Push payloads (FCM)
The worker sends FCM HTTP v1 messages: a `notification` Android shows by itself, on the push's channel, and `data` for the app. One notification per duel, friend or Daily on the phone (`collapse_key` and `tag`); turn pushes go at high priority, and the TTL ends with the turn.
```json
{ "message": {
    "token": "…",
    "notification": { "title": "Chidi don play, na your turn! 🔥", "body": "Oya, come show am say you sabi." },
    "data": { "type": "your_turn", "url": "/duel/d_01J9", "duel_id": "d_01J9" },
    "android": { "priority": "high", "ttl": "86400s", "collapse_key": "duel:d_01J9",
                 "notification": { "channel_id": "duels", "tag": "duel:d_01J9", "color": "#008751" } } } }
```

| Type | Sent when | To | Channel, opens |
|---|---|---|---|
| `your_turn` | A direct challenger finishes their first turn ("Tolu don challenge you! 🔥"), the turn passes, or the duel goes to a tie-break | Whoever must play now (both but the last player, for a tie-break) | `duels`, `/duel/{id}` |
| `duel_expiring` | 24 h and 4 h before the turn runs out | Whoever's turn it is | `duels`, `/duel/{id}` |
| `duel_result` | A duel ends, by points or by time | Each player who didn't end it | `duels`, `/duel/{id}` |
| `friend_joined` | A friend request arrives, or yours is accepted | The other player | `friends`, `/friends` |
| `daily_live` | 09:00 WAT | Players who played a Daily in the last week and not yet today (with their streak) | `daily`, `/daily/play` |

`league_recap`, `party_invite` and `content_correction` come with leagues, party rooms and re-scoring. A player's waiting push about a duel is dropped once they act in it.

## 5. Deep links
| URL | App route | Web fallback |
|---|---|---|
| `whosabi.ng/d/{token}` | `/duel/accept/{token}` | **Web app**: challenger card, then play your turn in the browser (or get the app) |
| `whosabi.ng/r/{CODE}` | `/party/join/{CODE}` | **Web party client** (play in the browser; signed-in web players join as themselves) |
| `whosabi.ng/u/{username}` | `/profile/{username}` | Web app profile page (`noindex`) |
| `whosabi.ng/daily/{n}` | `/daily` | **Web app**: play today's Daily |
| `whosabi.ng/l/{invite}` | `/league/join/{invite}` | Web app: join the league |

The link service serves OG tags (`og:title`, `og:description`, and `og:image` 1200×630 ≤ 300 KB) to link-preview bots, so WhatsApp shows a rich preview. People are sent on to the app if it is installed, or to the web app if not.

**At launch (step 2.5a)** the API is the link service, since it serves the web app from the same origin (Heroku): every page of the web app gets its OG and Twitter tags in `index.html`. A challenge link names the challenger ("tolu don challenge you on Who Sabi?"; "Someone" for guests and 13–17s), a Daily link names the Daily, and every other page gets the game's own preview. Links to the app's paths open the installed app through Android App Links and iOS Universal Links:

| Path | Who | Returns |
|---|---|---|
| `GET /og/default.png`, `/og/invite/{token}.png`, `/og/daily/{n}.png` | Anyone, 60 a minute per IP | The preview pictures, 1200×630 PNG, `public` cache (5 minutes for invites, a day for the rest); 404 for invites and Dailies that don't exist (or haven't started) |
| `GET /v1/share/duels/{id}/card.png` | The duel's two players, 20 a minute | The result for WhatsApp Status (mockup 14), 1080×1920 PNG, `private`; 409 until the duel is over |
| `GET /v1/share/daily/{n}/card.png` | The player who finished it | Their Daily for Status: score, time, coloured squares, streak and the share beaten, never the answers; 409 until finished |
| `GET /.well-known/assetlinks.json` | Android | The app (`ng.whosabi.app`) and its signing certificates from `ANDROID_CERT_SHA256`; an empty list while unset |
| `GET /.well-known/apple-app-site-association` | iOS | `/d/*`, `/daily/*`, `/duel/*` for `{APPLE_TEAM_ID}.ng.whosabi.app`; 404 while unset |

Pictures name only players with a public name: a guest or a 13–17 shows as "Player". When the web app moves to its own origin, the edge sends `/og/` and `/.well-known/` to the API as it does `/v1/`.
