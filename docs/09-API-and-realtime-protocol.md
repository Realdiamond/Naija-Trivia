# 09 · API & Realtime Protocol

**Version:** 1.0 · **Date:** 14 Oct 2026
**Base URL:** `https://api.whosabi.ng/v1` · **Realtime:** `wss://rt.whosabi.ng` (Colyseus)
**Source of truth:** Zod schemas in `packages/shared-types` generate the OpenAPI 3.1 spec (`/v1/openapi.json`) and the TS clients.

---

## 1. Conventions
- **Auth:** `Authorization: Bearer <access JWT>` (ES256, 15 min). Guests get a guest JWT.
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
| POST | `/auth/otp/send` | `{phone}` → `{request_id, resend_after_s}` |
| POST | `/auth/otp/verify` | `{request_id, code, merge_guest: true}` → `{access, refresh, user, is_new}` |
| POST | `/auth/google` | `{id_token}` → tokens |
| POST | `/auth/apple` | `{identity_token, nonce}` → tokens |
| POST | `/auth/refresh` | `{refresh}` → rotated tokens (reuse → 401 and the whole family revoked) |
| POST | `/auth/logout` | – → 204 |

### 2.2 Me & profile
| Method | Path | Notes |
|---|---|---|
| GET | `/me` | Profile, level, tier, balances, entitlements, settings, flags |
| PATCH | `/me` | `{username?, avatar_id?, home_state?, language?, data_saver?, family_mode?, discoverable?}` |
| POST | `/me/age` | `{age_band}`. One-time; changes go through support |
| POST | `/me/consents` | `[{purpose, granted, policy_version}]` |
| POST | `/me/devices` | `{device_id, push_token, model, ram_mb, app_version}` |
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
| POST | `/discovery/prefixes` | `{prefixes: ["a1b2c", …]}` (20-bit hex) → `{matches: [{hash, user_id, username, avatar}]}` |
| POST | `/blocks` | `{user_id}` |

### 2.4 Content
| Method | Path | Notes |
|---|---|---|
| GET | `/categories` | With localised names and colours |
| GET | `/packs` | Catalogue with access state |
| GET | `/packs/{id}/practice` | 50 questions **with** answers (practice only, no rating), signed URLs for media |
| POST | `/questions/{id}/reports` | `{reason, note?}` |

### 2.5 Duels
| Method | Path | Notes |
|---|---|---|
| POST | `/duels` | `{opponent: {user_id} | {random: true} | {link: true}}` → `{duel, invite_url?}` |
| GET | `/duels?state=active|done` | List for home screen |
| GET | `/duels/{id}` | Full state (questions only for completed rounds) |
| POST | `/duels/{id}/rounds/{n}/category` | `{category_id}` (must be one of `offered`) |
| POST | `/duels/{id}/rounds/{n}/questions/{seq}/serve` | → one question (shuffled, no answer), `time_limit_ms` |
| POST | `/duels/{id}/rounds/{n}/questions/{seq}/answer` | `{display_index | null, client_elapsed_ms, lifeline?}` → `{correct, correct_display_index, points, fact, running_score}` |
| POST | `/duels/{id}/lifelines` | `{type: "fifty"|"ask_naija"|"skip"|"time", round, seq}` → effect payload; debits coins |
| POST | `/duels/{id}/decline` · `/cancel` · `/rematch` | |
| GET | `/invites/{token}` | Public preview for the link page (challenger name, avatar) |
| POST | `/invites/{token}/accept` | Binds `player_b` |

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
{ "correct": true, "correct_display_index": 1, "points": 172,
  "breakdown": {"base":100,"speed":72,"streak":0},
  "fact": "Niyi Akinmolayan directed the 2017 sequel.", "running_score": 640 }
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

### 2.9 Leagues (v1.1)
`POST /leagues`, `POST /leagues/join {invite_code}`, `GET /leagues/{id}`, `GET /leagues/{id}/week/{iso}`, `GET /leagues/{id}/recap.png`.

### 2.10 Admin (CMS, SSO + RBAC)
`/admin/questions` (CRUD, workflow transitions, CSV import), `/admin/media`, `/admin/packs`, `/admin/daily/{date}`, `/admin/reports`, `/admin/users/{id}` (support view), `/admin/moderation`, `/admin/config`, `/admin/sponsors`, `/admin/prize-events`, `/admin/audit`.

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
| `whosabi.ng/d/{token}` | `/duel/accept/{token}` | Landing page: challenger card, "Play in app" / store |
| `whosabi.ng/r/{CODE}` | `/party/join/{CODE}` | **Web guest client** (play in browser) |
| `whosabi.ng/u/{username}` | `/profile/{username}` | Profile card + store |
| `whosabi.ng/daily/{n}` | `/daily` | Today's daily teaser |
| `whosabi.ng/l/{invite}` | `/league/join/{invite}` | League landing |

The landing pages serve OG tags: `og:title`, `og:description`, and `og:image` 1200×630 ≤ 300 KB, so WhatsApp shows a rich preview.
