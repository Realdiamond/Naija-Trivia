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
| POST | `/auth/guest` | `{device_id, platform}` → `{access, refresh, user}` |
| POST | `/auth/otp/send` | `{phone, platform, turnstile_token?}` → `{request_id, resend_after_s}`. `platform` picks the SMS template (TRD FR-AUTH-2); the web needs a Turnstile token |
| POST | `/auth/otp/verify` | `{request_id, code, merge_guest: true}` → `{access, refresh, user, is_new}` |
| POST | `/auth/google` | `{id_token}` → tokens |
| POST | `/auth/apple` | `{identity_token, nonce}` → tokens |
| POST | `/auth/refresh` | App: `{refresh}` → rotated tokens. Web: no body; the cookie is read and rotated, and `X-Requested-With` plus an allowed `Origin` are required. Reuse → 401 and the whole family revoked |
| POST | `/auth/logout` | – → 204 |
| POST | `/auth/logout-all` | Revokes every session on every platform ("Sign out everywhere") → 204 |

### 2.2 Me & profile
| Method | Path | Notes |
|---|---|---|
| GET | `/me` | Profile, level, tier, balances, entitlements, settings, flags |
| PATCH | `/me` | `{username?, avatar_id?, home_state?, language?, data_saver?, family_mode?, discoverable?}` |
| POST | `/me/age` | `{age_band}`. One-time; changes go through support |
| POST | `/me/consents` | `[{purpose, granted, policy_version}]` |
| POST | `/me/devices` | `{device_id, platform, push_token, model, ram_mb, app_version, browser?}` (web push tokens come from the Firebase JS SDK) |
| GET | `/me/stats` | Per-category accuracy, best streak, duel W/L |
| POST | `/me/delete` | Starts erasure (30-day SLA); returns a `dsar_id` |
| POST | `/me/export` | DSAR access export (emailed / in-app download link) |
| GET | `/users/{username}` | Public profile card |

### 2.3 Social
| Method | Path | Notes |
|---|---|---|
| GET | `/friends` | Accepted plus pending |
| POST | `/friends/requests` | `{user_id}` or `{username}` |
| POST | `/friends/requests/{id}/accept` · `/decline` | |
| DELETE | `/friends/{user_id}` | |
| POST | `/discovery/prefixes` | `{prefixes: ["a1b2c", …]}` (20-bit hex) → `{matches: [{hash, user_id, username, avatar}]}`. App only; the web has no contacts access |
| POST | `/blocks` | `{user_id}` |

### 2.4 Content
| Method | Path | Notes |
|---|---|---|
| GET | `/categories` | With localised names and colours |
| GET | `/packs` | Catalogue with access state |
| GET | `/packs/{id}/practice` | 50 questions **with** answers (practice only, no rating), signed URLs for media |
| POST | `/questions/{id}/reports` | `{reason, note?}` |
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

### 2.6 Daily
| Method | Path | Notes |
|---|---|---|
| GET | `/daily/today` | `{id, date, played: bool, streak}` |
| POST | `/daily/{id}/questions/{seq}/serve` · `/answer` | Same contract as duels |
| GET | `/daily/{id}/result` | `{score, grid, percentile, state_rank, share_text}` |
| GET | `/daily/{id}/leaderboard?scope=global|state|friends` | Top 100 + self |

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

## 4. Push payloads (FCM data messages)
```json
{ "type": "your_turn", "duel_id": "d_01J9", "opponent": "Chidi",
  "title": "Chidi don play! 🔥", "body": "Na your turn. Round 2 — Nollywood dey wait.",
  "deeplink": "whosabi://duel/d_01J9", "collapse_key": "duel_d_01J9" }
```

## 5. Deep links
| URL | App route | Web fallback |
|---|---|---|
| `whosabi.ng/d/{token}` | `/duel/accept/{token}` | **Web app**: challenger card, then play your turn in the browser (or get the app) |
| `whosabi.ng/r/{CODE}` | `/party/join/{CODE}` | **Web party client** (play in the browser; signed-in web players join as themselves) |
| `whosabi.ng/u/{username}` | `/profile/{username}` | Web app profile page (`noindex`) |
| `whosabi.ng/daily/{n}` | `/daily` | **Web app**: play today's Daily |
| `whosabi.ng/l/{invite}` | `/league/join/{invite}` | Web app: join the league |

The link service serves OG tags (`og:title`, `og:description`, and `og:image` 1200×630 ≤ 300 KB) to link-preview bots, so WhatsApp shows a rich preview. People are sent on to the app if it is installed, or to the web app if not.
