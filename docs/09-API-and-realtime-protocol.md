# 09 · API & Realtime Protocol

**Version:** 1.1 · **Date:** 15 Oct 2026 · *1.1 adds web sessions, web payments, event ingest and the admin API*
**Base URL:** `https://api.whosabi.ng/v1` · **Realtime:** `wss://api.whosabi.ng/v1/party/socket` (party rooms, §3)
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
- **Compression:** replies of 1 KB or more come Brotli- or gzip-compressed when the client sends `Accept-Encoding` (step 2.8b); the web app's files are compressed once at build time.

## 2. REST endpoints (MVP)

### 2.1 Auth
| Method | Path | Body → Response |
|---|---|---|
| GET | `/auth/methods` | – → `{guest: true, phone, email, google, apple}`: the sign-in methods switched on, so the apps show only those buttons. Phone is off in production until an SMS provider is set up, and email until Resend is |
| POST | `/auth/guest` | `{device_id, platform}` → `{access, refresh, user}` |
| POST | `/auth/otp/send` | `{phone, platform, turnstile_token?}` → `{request_id, resend_after_s: 30}`. Nigerian mobile numbers only, in any common format (normalised to +234…). `platform` picks the SMS format (TRD FR-AUTH-2). A Turnstile token is needed on the web, and in the apps from a number's third code of the day (`CAPTCHA_REQUIRED`, `CAPTCHA_FAILED`). Limits: 30 s between codes to a number (`429` with `Retry-After`), 5 codes per number and 10 per device a day (`OTP_LIMIT_REACHED`), and a per-IP hourly cap. A code the SMS providers could not send is not counted (`503 PROVIDER_UNAVAILABLE`), and both phone endpoints answer `503 PROVIDER_UNAVAILABLE` while phone sign-in is off |
| POST | `/auth/otp/verify` | `{request_id, code, merge_guest?: true}` → `{access, refresh, user, is_new, merged_guest}`. A code lasts 5 minutes, allows 5 tries (`OTP_INVALID` says how many are left, then `OTP_TOO_MANY_ATTEMPTS`), works once, and is retired when a newer code is sent (`OTP_EXPIRED`) |
| POST | `/auth/email/send` | `{email, platform, turnstile_token?}` → `{request_id, resend_after_s: 30}` (step 2.10). The address is trimmed and lower-cased; the code goes by email through Resend, with the code in the subject too. The same human check and limits as phone codes, counted per address: 30 s between codes, 5 a day per address and 10 per device, the per-IP hourly cap, an unsent code not counted. `503 PROVIDER_UNAVAILABLE` while email sign-in is off |
| POST | `/auth/email/verify` | `{request_id, code, merge_guest?: true}` → same as phone verify. A code lasts 10 minutes, with the same 5 tries, single use and retirement by a newer code. Phone and email codes are kept apart: one's `request_id` never works on the other's endpoint |
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
| GET | `/me` | Profile, settings, age band, level with XP progress, rating and tier, `staff` (an owner or admin playing with their staff Google account: the app shows the Staff tab, step 2.9a) `push_off` (kinds of push switched off) and `notices` (step 2.7d: a moderator's warning, or the username taken away, until seen). Balances, entitlements and flags join with their steps |
| GET | `/me/stats` | Step 2.11. The Profile's numbers: `{duels: {played, won, lost, drawn}, daily: {played, streak, best_streak}, party: {played, won}, practice: {games}, categories: [{category_id, answered, correct}]}`. Duels count once finished or forfeited; the streak is as it stands today (0 once it can't be saved); categories add up the player's duel and Daily answers, most answered first |
| GET | `/me/friend-code` | Step 2.12. `{url, svg}`: the player's `whosabi.ng/u/{username}` link and it as a QR code (SVG) that friends scan with their phone's camera. Accounts with a username (`403 ACCOUNT_REQUIRED` otherwise); 30 a minute |
| POST | `/me/notices/{id}/seen` | Step 2.7d. The player read a notice → `204`. A banned player can't sign in or refresh: sign-in is `403 ACCOUNT_UNAVAILABLE` saying until when and how to appeal; a ban with an end lifts itself the next time they try |
| PATCH | `/me` | `{username?, avatar_id?, home_state?, language?, data_saver?, family_mode?, discoverable?, push_off?}`, all optional. `push_off` lists the kinds switched off, from `duels`, `friends` and `daily` (step 2.5c); the push job drops those (`muted`) on every device. `data_saver` is `true` or `false` for the player's choice, or `null` for automatic, where the app turns it on when the phone or browser says data is tight (step 2.8b); `GET /me` returns it the same way. The username needs an account and is chosen once (`USERNAME_LOCKED`; support changes it): 3–20 letters, digits or `_`, unique ignoring case (`USERNAME_TAKEN`), and filtered for offensive and official-looking names (`USERNAME_NOT_ALLOWED`). Restricted (13–17) accounts can't turn family mode off or become discoverable |
| POST | `/me/age` | `{age_band: under_13 | 13_17 | 18_plus}`. One-time (`AGE_ALREADY_SET`; changes go through support). `under_13` is refused (`AGE_NOT_ALLOWED`). `13_17` makes the account restricted (doc 10 §3.3): family mode on, not discoverable; a guest who answers 13–17 becomes a restricted account when they sign up. A restricted account then needs a parent's or guardian's consent (`guardian: "needed"` on `/me`, step 2.8d): until it's given, a username or anything under `/friends` is refused (`GUARDIAN_CONSENT_REQUIRED`) |
| POST | `/me/guardian/send` | Step 2.8d. `{phone | email, platform, turnstile_token?}` → `{request_id, resend_after_s}`: a code to the parent or guardian by text or email, explaining what they agree to. Only for a restricted account still waiting (else 409), never to the player's own number or address (400). The same limits and human check as sign-in codes |
| POST | `/me/guardian/verify` | Step 2.8d. `{request_id, code}` from the same player → `Me` with `guardian: "given"`. Kept as a `consent_records` row (purpose `guardian`, source `guardian_code`) with how it was given and the contact only masked and hashed |
| POST | `/me/consents` | `{source: onboarding | settings | web_banner, consents: [{purpose, granted, policy_version}]}`. Purposes: `terms`, `privacy`, `analytics`, `marketing_push`, `ads_personalisation`, `contacts`, `session_replay`. Each change is a new `consent_records` row (the history is kept) and a `consent_changed` event; `204` |
| POST | `/me/devices` | Turns pushes on for this phone or browser; `204`. Android: `{platform: android, push_token, app_version?, model?}`. A browser (step 2.5c): `{platform: web, subscription: {endpoint, keys: {p256dh, auth}}, app_version?, browser?}`, what `PushSubscription.toJSON()` gives; the endpoint must be https at a browsers' push service (Google, Mozilla, Apple, Microsoft), anything else is `400`. Sent on every start (the token or subscription can change); it moves to whoever is signed in there. A player keeps their 10 newest. 30 an hour. iOS joins with its build (step 2.8) |
| DELETE | `/me/devices` | `{push_token}` (the FCM token, or a browser's endpoint): pushes off there (on sign-out); `204` |
| GET | `/push/web-key` | – → `{public_key}`: the VAPID public key browsers subscribe with, or `null` while web push is off |
| GET | `/me/stats` | Per-category accuracy, best streak, duel W/L |
| POST | `/me/delete` | Step 2.8a. `{confirm: true}` → `{dsar_id}`: erases the account at once (doc 08 §4) and signs it out everywhere. In Settings and at `/delete-account` on the web (Google Play's rule). 5 an hour |
| GET | `/me/export` | Step 2.8a. The player's data as a JSON download (`content-disposition: attachment`): profile, sign-in methods, consents, duels, Dailies, party games, coins and gems, purchases, devices and what the team told them. Logged as a completed access request. 10 an hour |
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
| GET | `/packs` | Step 2.8f. `{packs: [{id, slug, title, description, category_id, access: free\|coins\|pass\|sponsored, price_coins, unlocked, questions, ends_at}]}`: active packs in their dates with at least 10 questions for this player (family-safe ones only in family mode; never one in today's or a planned Daily). The six core packs are each a whole category |
| POST | `/packs/{id}/unlock` | Step 2.8f. Unlocks a coins pack for good: `{pack, coins}` (the balance after). Unlocking again costs nothing; `409 NOT_ENOUGH_COINS`; a Sabi Pass pack is `409 PACK_LOCKED` until v1.1. 20 a minute |
| GET | `/packs/{id}/practice` | Step 2.8f. The week's practice set: `{pack_id, week, issued_at, time_limit_ms, questions: [{qid, category_id, type, text, options (canonical order), correct_index, fact, difficulty}]}`, up to 50 questions **with** their answers (TRD FR-CON-3), so Practice plays offline. The same questions all week (ISO week, WAT), unseen ones first, less any taken out of play since; they count as seen, so the player's duels prefer others. A locked pack is `409 PACK_LOCKED`. 30 a minute. Picture questions wait for media |
| POST | `/practice/results` | Step 2.8f. A finished practice game, sent when online: `{id (uuid made on the device), pack_id, week, played_at, answers: [{qid, picked (canonical) \| null, elapsed_ms}] (1–10, each once), complete}` → `{correct, answered, xp, capped, level}`. Answers are checked against the questions as they are now, and must come from the player's set for that pack and week (`404` without one, `400` otherwise); `played_at` within the last 14 days. XP as GDD §5.1 (+10 right, +2 wrong, +50 for a full game finished), up to `practice.xp_daily_cap` a WAT day; no coins of its own, no rating. The same `id` again returns what it paid. 60 a minute |
| POST | `/questions/{id}/reports` | `{reason: wrong_answer|outdated|offensive|typo|unfair, note?}` → `202`. Once per player and question (again is still `202`), 30 an hour per player, only for questions players can have seen. Five open "wrong answer" reports, or open reports on more than 3% of plays (from 100 plays), suspend the question at once |
| POST | `/support/tickets` | Step 2.7p. Writing to support from the app's Help screen: `{topic: purchase\|streak\|question\|account\|sign_in\|ban\|other, message (10–2,000 characters), email?, device?}` → `201` with the message. The platform comes from the session and the app version from `X-App-Version`. Kept for the console, and emailed to `SUPPORT_INBOX` (the helpdesk) when set, with the player's email to reply to and a link to their page in the console; a message the inbox can't take is still kept. 5 an hour per player (`429`) |
| GET | `/support/tickets` | Step 2.7p. The player's last 20 messages: `{tickets: [{id, topic, message, status: open\|answered, answer, created_at, answered_at}]}`; `answer` is what support wrote for the app (null when answered by email) |
| POST | `/rounds` | `{mode: "taste_test"}` → `{round_id, mode, total, categories}`. The first-run taste test: one easy, family-safe question each from Slang, Food and Music (PRD US-1). Practice and the Daily will use the same round flow |
| POST | `/rounds/{id}/questions/{seq}/serve` · `/answer` | Same contract as duels (§2.5): one question at a time, served time recorded once, answers idempotent |
| GET | `/rounds/{id}` | `{total, answered, correct_count, score, complete, answers[]}` |

### 2.5 Duels
| Method | Path | Notes |
|---|---|---|
| POST | `/duels` | `{opponent: {user_id} | {random: true} | {link: true}}` → `201 {duel, invite_url}`. Takes `Idempotency-Key`. At most 20 duels going per player (`DUEL_LIMIT_REACHED`). `random` seats you in a waiting random duel near your rating (±200, widening by 100 every 10 s of its wait), or starts one; after 60 s with nobody, the Sabi Bot plays it (`source: "bot"`, unrated). The bot can't be challenged by `user_id` (`OPPONENT_UNAVAILABLE`) and plays no rematches (409) |
| GET | `/duels?state=active|done&limit&cursor` | List for the home screen: active ones with "your turn" first, soonest deadline first; finished ones newest first, paged by `cursor` |
| GET | `/duels/{id}` | The duel from your side: scores, `next` action, rounds, tie-break, and once it finishes with a result `reward: {coins, xp}` (step 2.4a). Questions, answers and the opponent's points only for rounds you have finished |
| POST | `/duels/{id}/rounds/{n}/category` | `{category_id}`, one of the 3 offered. Picked by A (rounds 1 and 3) or B (round 2) during their turn → the duel |
| POST | `/duels/{id}/rounds/{n}/questions/{seq}/serve` | → one question (shuffled, no answer), `time_limit_ms`. Serving again returns the same `served_at`. Round 4 is the tie-break: one `closest_number` question with no options. Rounds 1–3 add `lifelines: {used, removed, ask_naija}` (step 2.4b): the lifelines this player has used in the duel, and what 50/50 and Ask Naija show on this question, in their option order |
| POST | `/duels/{id}/rounds/{n}/questions/{seq}/answer` | `{display_index | null, client_elapsed_ms, tab_hidden_ms?}` → `{correct, timed_out, correct_display_index, points, breakdown, fact, running_score, streak, next}`. Round 4 takes `{guess | null, client_elapsed_ms}` → `{guess, timed_out, answer, fact, decided, result}`. A retry gets the first answer back; a different `Idempotency-Key` for an answered question is `409 ALREADY_ANSWERED` |
| POST | `/duels/{id}/lifelines` | Step 2.4b. `{type: "fifty"|"ask_naija"|"skip"|"time", round, seq}` on the question being played → `{question, coins}`: the question with its effect (after Skip, the new question with its own clock; after +10s, `time_limit_ms` 10 s longer) and the coins left. Costs 60, 80, 100 and 40 coins, taken before the effect in one transaction. One of each per duel (`409 LIFELINE_USED`); the same request again returns the same at no charge. `409 NOT_ENOUGH_COINS`; `409 LIFELINE_NOT_ALLOWED` once answered, after time is up, or 50/50 on a two-option question; never in the tie-break or the Daily |
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
| GET | `/daily/{id}/result` | `{correct_count, score, total_ms, grid, categories, percentile, players, state: {code, rank, players}, leading_state, streak: {…, used_freeze}, xp, coins, share_text, share_url, review[]}`. `percentile` is the share of the day's other players you beat (null while you are the only one); `review` has each question, its answer and fact. `DAILY_NOT_FINISHED` before the 7th answer |
| GET | `/daily/{id}/leaderboard?scope=global|state|friends` | Top 100 + `me`: `{board, period, scope, state, players, resets_at, entries[], me}`. Each entry: `{rank, kind: player|guest|restricted, username, avatar_id, home_state, level, tier, score, you}`. Guests and 13–17s show no name or avatar on public boards (doc 10 §3.3); friends see each other's names |
| GET | `/leaderboards/week?scope=global|state|friends` | The same for this week's Daily points, Monday to Sunday WAT |

### 2.7 Party (REST side)
Party rooms run in the API process (build step 2.2a); these make rooms and hand out seats, and each seat then talks to its room over the WebSocket in §3.

| Method | Path | Notes |
|---|---|---|
| POST | `/party/rooms` | Signed in. `{settings: {questions: 5|10|15|20, timer_s: 10|15|20, categories[], family_safe, wahala, host_plays}, nickname?}` → `201 {room, seat}`. A player with no username yet (a guest) gives a nickname (`NICKNAME_REQUIRED`). `host_plays: false` is host screen mode. 30 an hour per address |
| GET | `/party/rooms/{code}` | Public, the card behind `/r/{CODE}`: `{code, link, host, status: lobby|playing|podium, players, max_players, names[], locked, settings}`. `PARTY_ROOM_NOT_FOUND` once it closed |
| GET | `/party/rooms/{code}/qr.svg` | Public: the room's link as a QR code, for the lobby |
| POST | `/party/rooms/{code}/join` | Signed in (joins as yourself), or no session with `{nickname}` (a web guest, FR-PARTY-7) → a seat. `{screen: true}`: a big screen (a TV) that shows the game without playing, for the host only. `PARTY_ROOM_FULL` when full (20) or locked, `NICKNAME_NOT_ALLOWED` for a rude or official-looking name |
| GET | `/party/games/{id}` | A finished game: `{game_id, room_code, ended_at, questions, ranking[{rank, name, kind, score, correct}], mvp}`. Deleted players show as "Deleted player" and 13–17s as "A player" |

A **seat** is `{room_id, code, token, socket_path, expires_at}`. The token is a 12-hour JWT for that room's socket only (never the API), and the same token reconnects.

### 2.8 Economy & shop
| Method | Path | Notes |
|---|---|---|
| GET | `/wallet` | `{coins, gems}` (step 2.4a). A guest has one too; it moves into the account they sign in to |
| GET | `/wallet/history?before=` | Newest first, 30 a page: `{items: [{id, amount, currency, reason, ref_type, ref_id, created_at}], next}`. `reason` is `duel_win`, `duel_loss`, `duel_draw`, `daily`, `level_up`, `merge`, `lifeline`, `rewarded_ad`, `iap`, `refund` or `admin_grant`; `ref_type` is `duel`, `daily`, `level`, `party` or `user` (step 2.4a) |
| GET | `/shop` | `{packs: [{sku, coins, bonus_pct, price_ngn}]}`, the coin packs (step 2.4d); cosmetics, gems and offers come with v1.1. The app shows the store's own price. No packs while the shop's kill switch is off (step 2.7c) |
| GET | `/config` | Step 2.7c, signed in or not. `{flags: {key: bool}, banner: {level, text_en, text_pcm} | null, values: {key: number}, refresh_s: 45}`: the flags as they apply to this player (platform and app version from the token or the `x-platform` and `x-app-version` headers; a share of players by their id) and the status banner. Apps look again every `refresh_s`; a kill switch reaches every player within a minute (doc 18 AD-7). Party rooms switched off: creating or joining a room is `503 FEATURE_OFF` with words for the player. `values` (step 2.7g) are the tuned numbers the apps need too: lifeline prices, rewarded video coins and ad pacing. `home` (step 2.7h) lists the Home banners and events running now for this platform, newest first, at most two: `{id, kind: banner | double_xp, title_en, title_pcm, body_en, body_pcm, action, category_id, ends_at}`, where `action` is the screen a tap opens (`daily`, `random`, `party`, `challenge`, `leaderboards`, `shop`, `friends`) and a `double_xp` event (Weekend Wahala) doubles duel XP for answers in `category_id` (every category when null) |
| POST | `/shop/events` | Step 2.4d. `{kind: opened|started, sku?}` → `204`: the payment journey for staff alerts (`payment_opened` at most once an hour per player, `payment_started` once in ten minutes per pack). 30 a minute |
| POST | `/shop/purchase` | `{item_id, currency}` (coins/gems only; real money goes through the stores) |
| POST | `/inventory/equip` | `{cosmetic_id}` |
| GET | `/ads/ssv` | **AdMob SSV callback** (step 2.4c). The signature over the query string up to `&signature=` is checked against Google's published keys (fetched daily, and again for an unknown `key_id`); `403` if it doesn't verify. Pays 25 coins to `user_id` when `custom_data` is `coins` (the server's amount, not the callback's), once per `transaction_id`, up to 10 a WAT day; every callback is kept in `ad_rewards`. Anything accepted is `200 {outcome: granted|capped|duplicate|not_ours}`, so Google stops retrying |
| GET | `/ads/rewarded` | Step 2.4c. `{coins, left_today}`: what a rewarded video pays and how many more will pay today |
| POST | `/webhooks/revenuecat` | Step 2.4d. `Authorization` must equal `REVENUECAT_WEBHOOK_AUTH` (else `401`). A coin pack's `NON_RENEWING_PURCHASE` from Google Play or the App Store credits the pack's coins (our number, by `product_id`) to `app_user_id`, once per `transaction_id` (`purchases.store_tx_id`), and raises a `payment_paid` staff alert; sandbox purchases say so. A `CANCELLATION` with `cancel_reason: CUSTOMER_SUPPORT` (a refund) takes back what is left of the coins. A payment for a player we don't know is a `problem` alert and no coins. Anything handled is `200 {outcome}`, so RevenueCat stops retrying; subscriptions (the Sabi Pass) come in v1.1 |
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

Staff alerts (step 2.9b), for owners and admins: `GET /admin/alerts?before=` (newest first, 50 a page, with `unread` against the newest the person has seen) · `POST /admin/alerts/seen {up_to}` · `GET` and `PUT /admin/alerts/settings {kind, enabled}` (kinds `problem`, `signup`, `payment_opened`, `payment_started`, `payment_paid`; all on until switched off) · `POST /admin/phones/push {push_token}` from a phone session, so alerts reach that phone. The worker pushes each alert at once, day or night, on the `staff` Android channel; four or more of one kind together go as one push ("5 new sign-ups 🎉"). Problems today: a question suspended by player reports, no Daily for today or tomorrow (once per date), a worker job failing three runs in a row (once per job every 6 hours). The payment kinds come from the shop (step 2.4d): opening it, tapping buy, and RevenueCat's word that the payment went through.

The Content module (step 2.6a): `GET /admin/questions?status=&category=&q=&reported=&cursor=` (writers see only their own) · `POST /admin/questions` (a draft) · `GET` and `PUT /admin/questions/{id}` (the detail has live stats, the Question Bible checks, look-alikes, the moves you may make and the history; an edit is a new version) · `POST /admin/questions/{id}/actions {action, note?}` with `submit`, `approve` (never your own), `send_back` (with a note), `publish`, `suspend`, `restore`, `retire`, `reopen` · `POST /admin/questions/{id}/renew` (step 2.6b-3: a trending question's next 90 days; a question marked `trending` leaves the game 90 days after going live) · `POST /admin/questions/publish {ids}` · `POST /admin/questions/import {csv, dry_run, publish_approved}` (seed or question-bank CSV, up to 3 MB) · `GET /admin/reports` (players' reports and, from step 2.6b, the nightly check's flags: reasons `too_hard`, `too_easy` and `wrong_answer`, with a note saying "From the numbers") · `POST /admin/questions/{id}/reports/resolve {resolution: fixed|rejected|retired, note?}`. Permissions: `content.view`, `content.write`, `content.review`, `content.publish`, `content.import` (doc 18 §3: writer, fact-checker, editor).

| Area | Endpoints |
|---|---|
| Overview & live | Built in step 2.7a, all with `overview.view`: `GET /admin/console/overview` (today so far against the same time last week, time spent, money, live games, health, queues, the last day's problems and the charts) · `GET /admin/live/online?platform=` (players seen in the last 5 minutes, the 100 latest, and by state) · `GET /admin/live/rooms` (the party rooms open, with their players) · `GET /admin/live/feed?after=` (the last hour's key events in words, PII-free; the console looks again every 5 s). With `live.manage` and a reason, both audited: `POST /admin/live/rooms/{code}/kick {player_id, reason}` (not the host) · `POST /admin/live/rooms/{code}/close {reason}`. `GET /admin/overview` stays the Staff tab's smaller set |
| Players | `GET /admin/users?q=` (search) · `GET /admin/users/{id}` (User 360 summary) · `GET /admin/users/{id}/timeline?from=&to=&types=` · `GET /admin/users/{id}/sessions` (sessions, and time per day, platform, area and hour) · `GET /admin/users/{id}/matches` · `GET /admin/users/{id}/money` (wallet, ledger, purchases, ad rewards) · `GET /admin/users/{id}/devices` · `GET /admin/users/{id}/notes` · `GET /admin/users/{id}/audit`. Built in step 2.7b except the timeline filters; each look at a tab is audited (`view_user_tab`) |
| Player actions | `POST /admin/users/{id}/reveal {field, reason}` · `POST /admin/users/{id}/actions {type, reason, …}` where `type` is `grant_coins` (`amount`), `restore_streak`, `sign_out`, `warn` (`message`), `mute`, `rename`, `shadow_restrict`, `unrestrict`, `ban` (`days`, null for good) or `unban` · `POST /admin/users/{id}/notes {body}`. Built in step 2.7b: notes (`players.view`), and `grant_coins`, `restore_streak` and `sign_out` (`players.support`, doc 18 §8 limits, `{done}` in words). Built in step 2.7d with `players.moderate`: `warn`, `rename` (the username taken away; the player picks a new one), `shadow_restrict` and `unrestrict` (left off the boards other players see), `ban` (moderators up to 30 days; longer or for good needs an admin; signs the player out everywhere) and `unban`. `mute` waits for something players can say |
| Analytics | `GET /admin/analytics/{dashboard}?from=&to=&platform=&segment=…` (server-side query templates) · `POST /admin/segments` · `GET /admin/segments/{id}/count` · `POST /admin/exports {query, reason}` → approval → signed link (24 h). Built in step 2.7j with `analytics.kpi` (owners, admins, analysts, growth, viewers): `GET /admin/analytics/engagement|growth|retention?from=YYYY-MM-DD&to=YYYY-MM-DD&platform=all|android|ios|web` (WAT days, up to 92 at a time; the last 30 days when left out). Step 2.7k: `GET /admin/analytics/gameplay` (`analytics.product`: owners, admins, analysts, LiveOps) and `GET /admin/analytics/monetisation|economy` (`analytics.money`: owners, admins, analysts, finance), with the same query. Step 2.7l: `GET /admin/analytics/funnels?funnel=first_time|daily|duel|party|purchase|custom&steps=event,event,…&window=hours` (`analytics.kpi`), `GET /admin/analytics/content` (`analytics.content`: owners, admins, analysts, LiveOps, editors), `GET /admin/analytics/tech` (`analytics.tech`: owners, admins, analysts, engineers) and `GET /admin/analytics/integrity` (`analytics.integrity`: owners, admins, analysts, moderators) · `GET /admin/metabase/embed/{dashboard}` (signed embed URL). Built in step 2.7o with `segments.manage` (owners, admins, analysts, growth): `GET /admin/segments` (saved segments with 30 days of counts, and this week's exports) · `POST /admin/segments/count {definition}` · `POST /admin/segments {name, definition}` · `DELETE /admin/segments/{id}` · `POST /admin/segments/{id}/exports {reason}` · `GET /admin/segment-exports/{id}/download` (CSV of pseudonymous ids, only for the asker, for a day after approval); and with `segments.approve` (owners, admins, never their own): `POST /admin/segment-exports/{id}/decision {approve}`; all audited |
| Alert rules | Built in step 2.7m with `alerts.manage` (owners, admins): `GET /admin/alert-rules` (each rule with its state, and which channels are set up) · `POST /admin/alert-rules {name, metric, comparison: below\|above\|drop_pct_vs_last_week, threshold, window_minutes, channels: phone\|email\|slack}` · `POST /admin/alert-rules/{id}` (any of those, and `enabled`) · `DELETE /admin/alert-rules/{id}`; all audited |
| LiveOps | `/admin/daily/{date}` · `/admin/config` (with history and rollback) · `/admin/flags` · `/admin/experiments` · `/admin/banners` · `/admin/events` · `/admin/push-campaigns` (v1.1) · `/admin/alerts`. Built in step 2.7c with `liveops.flags`: `GET /admin/flags` · `POST /admin/flags/{key} {enabled, rules: [{platform?, min_app_version?, percent?}], reason}` (audited; a kill switch flipped raises a staff alert) · `GET /admin/banner` · `POST /admin/banner {banner: {level, text_en, text_pcm} | null, reason}` (audited, with its history in `config_history`). Built in step 2.7f with `liveops.daily`: `GET /admin/daily` (the next 30 days with each Daily's questions, answers, stats and last use) · `POST /admin/daily/plan {reason}` (picks every missing Daily; those after tomorrow, or tomorrow before 22:00 WAT, stay open to swaps) · `GET /admin/daily/{date}` · `GET /admin/daily/{date}/candidates?slot=1-7` (questions that fit, the same category first) · `POST /admin/daily/{date}/swap {slot, question_id, reason}` (`409` once fixed at 22:00 WAT the day before; audited). Built in step 2.7g with `liveops.config`: `GET /admin/config` (each value staff may change, with its default, bounds and last change) · `POST /admin/config/{key} {value, reason}` · `GET /admin/config/{key}/history` · `POST /admin/config/{key}/rollback {reason}` (back to the value before the latest change); every change in `config_history` and the audit log. Built in step 2.7h with `liveops.config`: `GET /admin/events` (scheduled and running, then the last 20 ended) · `POST /admin/events {kind, title_en, title_pcm?, body_en?, body_pcm?, action?, category_id? (double XP only), platforms?, starts_at, ends_at (90 days at most), reason}` · `POST /admin/events/{id}/end {reason}`; audited |
| Content | `/admin/questions` (CRUD, workflow transitions, CSV import) · `/admin/media` · `/admin/packs` · `/admin/reports`. Built in step 2.8f, seen with `content.view` and changed with `content.publish` (editors, admins, owners): `GET /admin/packs` (each with its questions chosen and live) · `GET /admin/packs/{id}` (and its chosen questions) · `POST /admin/packs` · `PUT /admin/packs/{id}` `{title, slug, description, access, price_coins (coins packs only), category_id (also every live question in it), starts_at, ends_at, active}` · `POST /admin/packs/{id}/questions {refs}` (ids or references → `{added, already, unknown}`) · `DELETE /admin/packs/{id}/questions/{qid}`; packs are switched off, never deleted; all audited |
| Support | Built in step 2.7p with `players.support` (support, admins, owners): `GET /admin/support?status=open\|answered` (open ones oldest first, with the player, their app and device, the contact email masked, whether it reached the helpdesk; how many are open; whether `SUPPORT_INBOX` is set) · `POST /admin/support/{id} {status: answered\|open, answer?}` (an answer is what the player reads in the app's Help screen; without one it was answered by email; opening it again clears it; audited); and with `players.view`: `GET /admin/users/{id}/tickets` (on User 360's Support tab) |
| Safety | `/admin/moderation` · `/admin/integrity` (flags: dismiss or act) · `/admin/appeals`. Built in step 2.7d: `GET /admin/users/{id}/safety` (moderation history and integrity flags, `players.view`) · `GET /admin/integrity?status=open|dismissed|actioned` (riskiest first) · `POST /admin/integrity/{id} {status: dismissed|actioned, note}` (`players.moderate`, audited) |
| Commerce & sponsors | `/admin/purchases` · `/admin/refunds` · `/admin/reconciliation` · `/admin/sponsors` · `/admin/prize-events` (v2). Built in step 2.7i with `commerce.view` (owners, admins, finance): `GET /admin/commerce?status=completed|refunded&sandbox=true&before=` (today, 7 and 30 days, each WAT day's naira, packs, purchases missing their coins, and a page of purchases) · `GET /admin/commerce/export?month=YYYY-MM` (CSV for finance, players as pseudonymous ids; audited) |
| Compliance & settings | `/admin/dsar` · `/admin/consents` · `/admin/retention` · `/admin/audit` · `/admin/staff` (roles, with four-eyes approval). Built in step 2.8a: `GET /admin/dsar?status=open|done` (`compliance.view`) · `POST /admin/users/{id}/dsar {kind: access|erasure, note}` (support or the DPO log a request made by email or the help centre; due in 30 days) · `POST /admin/users/{id}/export {reason}` (`compliance.view`, logged before the data leaves) · `POST /admin/users/{id}/erase {reason}` (`compliance.erase`: the DPO and owners). Built in step 2.7n: `GET /admin/compliance/overview` (`compliance.view`: retention lines with their last run and oldest record, consent rates by purpose and platform, the staff list and the last access review) · `POST /admin/compliance/access-review {note}` (`compliance.review`: the DPO and owners; audited) |

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

## 3. Realtime protocol (Party Room)
Plain WebSockets carrying JSON, one message per frame, each with a `type` (doc 06 §2 says why not Colyseus).

### 3.1 Connection
1. The client gets a seat from `POST /party/rooms` or `POST /party/rooms/{code}/join`.
2. It opens a WebSocket to `{socket_path}?token={token}` on the API's host. A bad or expired token closes with 4003.
3. The server sends `welcome` (`{you: {id, name, role}, server_time}`) and the `state`, and catches up a player who comes back mid-question.

The server pings each connection every 15 s at the WebSocket level, which keeps it open through proxies (Heroku drops a connection idle for 55 s) and measures its round trip for the timing clamp (TRD §5.3). A connection may send about 10 messages a second; the rest are dropped.

### 3.2 Room state
A `state` message goes to everyone whenever something changes:
```ts
{ room_id, code, link, phase,      // LOBBY|COUNTDOWN|QUESTION|REVEAL|LEADERBOARD|PODIUM|CLOSED
  host_id, settings, locked, max_players,
  q_index, q_total,                // q_index from 0; -1 before the first question
  ends_at,                         // when this phase ends, server epoch ms; 0 while it waits for the host
  players: [{ id, name, kind /* app|web|web_guest */, avatar_id, score, connected, answered }] }
```
The question text and options are **sent as messages, not state**, so late joiners can't read them early.

### 3.3 Messages
| Direction | Type | Payload |
|---|---|---|
| C→S | `time` | `{t0}` → S→C `time {t0, ts}` (clock sync; the client keeps the median offset) |
| C→S (host) | `settings` | `{settings}` (lobby only) |
| C→S (host) | `start` | – (at least 2 players; `TOO_FEW_PLAYERS`, or `NO_QUESTIONS` when the packs run short) |
| C→S (host) | `kick` | `{player_id}` (they can't come back) |
| C→S (host) | `lock` | `{locked}` |
| S→C | `question` | `{index, total, qid, category_id, text, options[], time_limit_ms, ends_at, wahala}` (options in your order; a screen gets them as written) |
| C→S | `answer` | `{qid, display_index, client_elapsed_ms}` (first answer only; another gets `ALREADY_ANSWERED`) |
| S→C | `answered_ack` | `{qid}` |
| S→C | `reveal` | `{qid, correct_display_index, distribution[] (in your order), you: {display_index, correct, points, streak} | null, fact}` |
| S→C | `leaderboard` | `{top: [{id, name, score, rank, move}], you: {rank, score} | null, next: question|wahala|last|podium}` |
| S→C | `podium` | `{game_id, ranking[{rank, id, name, kind, avatar_id, score, correct}], mvp: {id, name, correct, total, fastest_ms} | null, share_url}` |
| C→S (host) | `play_again` | – (back to the lobby with the same players, scores at zero) |
| C→S | `leave` | – |
| S→C | `toast` | `{kind: "joined"|"left"|"host_changed"|"kicked", name}` |
| S→C | `error` | `{code, message}`: `NOT_HOST`, `NOT_NOW`, `TOO_FEW_PLAYERS`, `NO_QUESTIONS`, `BAD_MESSAGE`, `ALREADY_ANSWERED` |

Options are shuffled **per player**, so `reveal` sends each client its own correct display index (a message to that player, not a broadcast).

### 3.4 Timing on the server
```
on QUESTION start: ends_at = now + time_limit; answers count until ends_at + 300 ms grace
on answer: accepted = acceptElapsed(client_elapsed, now − sent_to_this_player_at, rtt(connection))
on (all answered) or (grace over): score all, phase = REVEAL (2.5 s) → LEADERBOARD (3 s) → next
the last 3 questions, with the Wahala Round on: harder, points × 2
```
A player who drops and comes back within a question gets it again, timed from when it was first sent. Someone new joins at the next question. A host gone for 60 s hands the room to whoever has been there longest; a room quiet for 10 minutes in the lobby or on the podium closes, and its code isn't reused for another 10 minutes.

### 3.5 Close codes
| Code | Meaning | Client action |
|---|---|---|
| 4000 | Room closed or ended | Show results or exit |
| 4001 | Kicked | Show message, don't auto-rejoin |
| 4002 | The same seat opened somewhere else | Say so; don't auto-reconnect |
| 4003 | Auth failed | Get a new seat and retry once |
| 4004 | Room full or locked | Show message |
| 1006 (abnormal) | Network drop | Auto-reconnect with backoff 0.5 s, 1 s, 2 s, 4 s… up to 60 s with the same seat token |

## 4. Push payloads
**Android (FCM).** The worker sends FCM HTTP v1 messages: a `notification` Android shows by itself, on the push's channel, and `data` for the app. One notification per duel, friend or Daily on the phone (`collapse_key` and `tag`); turn pushes go at high priority, and the TTL ends with the turn.
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
| `content_correction` | A played question's answer was corrected and the player's games from the last 14 days were re-scored (step 2.6b-2): "+173 points in your duel vs Tolu", "You won your duel vs Tolu! 🎉", "Your duel vs Tolu changed", or "+340 points from a corrected question" over several games. One push per player and correction | Each player who gained points, and both players of a duel whose result changed | `duels` (or `daily` for one Daily); the duel, else Home |

`league_recap` and `party_invite` come with leagues and party rooms. A player's waiting push about a duel is dropped once they act in it.

**Browsers (Web Push, step 2.5c).** The worker POSTs to the subscription's endpoint: the JSON `{title, body, url, type, tag}` encrypted for that browser (`Content-Encoding: aes128gcm`, RFC 8291), `Authorization: vapid t=<ES256 JWT for the push service's origin>, k=<public key>` (RFC 8292), `TTL` (the push's lifetime), `Urgency` (`high` for turns) and `Topic` (from the collapse key, so a newer push about the same duel replaces a waiting one). `404`/`410` ends the subscription; `429` and `5xx` are tried again. The service worker (`/sw.js`) shows it with `tag` and opens `url`, in an open game window when there is one.

## 5. Deep links
| URL | App route | Web fallback |
|---|---|---|
| `whosabi.ng/d/{token}` | `/duel/accept/{token}` | **Web app**: challenger card, then play your turn in the browser (or get the app) |
| `whosabi.ng/r/{CODE}` | `/party/join/{CODE}` | **Web party client** (`apps/web-guest`: play in the browser with a nickname); `/r/{CODE}?app=1` opens the room in the full web app, where a signed-in player joins as themselves |
| `whosabi.ng/u/{username}` | `/u/{username}` | **Web app** (step 2.12): the player's card; an account adds them as a friend or challenges them, a guest is asked to sign up. It is the player's friend code: the link, or the QR code of it, from `GET /v1/me/friend-code` |
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
| `GET /.well-known/apple-app-site-association` | iOS | `/d/*`, `/daily/*`, `/duel/*`, `/u/*` for `{APPLE_TEAM_ID}.ng.whosabi.app`; 404 while unset |

Pictures name only players with a public name: a guest or a 13–17 shows as "Player". When the web app moves to its own origin, the edge sends `/og/` and `/.well-known/` to the API as it does `/v1/`.
