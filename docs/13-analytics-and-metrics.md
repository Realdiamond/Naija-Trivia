# 13 · Analytics, Metrics & Experimentation

**Version:** 1.1 · **Date:** 15 Oct 2026 · **Tools:** our own event pipeline into ClickHouse, shown in the admin console ([doc 18](18-admin-console-and-analytics.md)); Metabase for exploration; in-house flags and experiments; Firebase Analytics in the mobile apps for ads attribution only; Sentry (stability)

> **What changed in 1.1:** PostHog is replaced by a first-party pipeline, so every event, session and minute of play sits in one store behind the admin console. Every metric splits by platform (Android, iOS, web). Metric definitions are in doc 18 §10.

---

## 1. Metric tree

```
North star: Weekly Social Matches (WSM)
= matches completed per week involving ≥ 2 humans who know each other (friends, league, party room)
│
├── Acquisition: installs, web first visits, invite-link opens, invite→install and invite→web-play conversion, web→account and web→app conversion
├── Activation: % new users who finish the taste test; % who complete 1st duel within 24h; % who add ≥1 friend
├── Engagement: matches/DAU, sessions/DAU, minutes/DAU, time by mode, Daily completion rate, avg questions/session
├── Retention: D1/D7/D30, weekly cohort retention, streak distribution
├── Virality: K-factor = invites sent/user × acceptance rate; shares/DAU
├── Monetisation: ARPDAU, rewarded views/DAU, payer conversion, ARPPU, pass conversion & churn
└── Quality: crash-free sessions, p95 serve→answer latency, reports/1k answers, OTP success rate, web vitals
```

## 2. Event taxonomy (naming: `object_action`, snake_case)

Common properties on every event: `event_id`, `ts`, `session_id`, `seq`, `screen`, `anon_id`, `platform` (android/ios/web), `browser` (web), `app_version`, `os_version`, `device_model`, `ram_mb`, `network_type` (wifi/4g/3g/2g/offline), `carrier` (MTN/Airtel/Glo/T2), `data_saver`, `language`, `age_band`, `home_state` (if set). The ingest service adds the pseudonymous `user_pid` and an approximate `geo_state`.

**Sent by** says who emits the event. Business events come from the **server** so the numbers match the database; the **client** only reports what only it can see (screens, time, taps, device and network).

| Event | Sent by | Key properties | Notes |
|---|---|---|---|
| `first_opened` | Client | `source` (organic/deeplink/referrer), `referrer` | Once per install or browser |
| `app_opened` | Client | `cold_start_ms`, `source` (push/deeplink/organic) | Cold start |
| `session_started` | Client | `source` | After 30 minutes of inactivity, or a fresh start |
| `app_foregrounded` / `app_backgrounded` | Client | `foreground_ms`, `screen`, `screen_ms` (on background) | **Time spent comes from these.** On the web: tab visible / hidden or `pagehide` |
| `screen_viewed` | Client | `screen` (`area.screen`, e.g. `duel.question`), `prev_screen`, `prev_screen_ms` | Time per screen. Re-sent on return to the foreground with an empty `prev_screen` |
| `taste_test_completed` | Client | `correct_count`, `duration_ms` | FTUE |
| `signup_completed` | Server | `method` (phone/email/google/apple), `merged_guest` | |
| `otp_sent` / `otp_verified` / `otp_failed` | Server | `provider`, `carrier`, `latency_ms`, `reason` | OTP health |
| `friend_added` | Server | `source` (contacts/username/opponent/link/qr) | |
| `invite_shared` | Client | `channel` (whatsapp/status/x/copy/web_share/other), `context` (duel/party/daily/profile) | |
| `invite_opened` | Server | `type`, `has_app`, `opened_in` (app/web_app/party_client) | From the link service |
| `duel_created` | Server | `opponent_type` (friend/random/link/rematch/bot) | Sent by whoever starts the duel: a random duel that another player joins, or the Sabi Bot takes, counts once as `random`. The bot's own play sends no events |
| `question_served` | Server | `qid`, `mode`, `seq` | |
| `question_answered` | Server | `qid`, `category`, `difficulty`, `correct`, `accepted_elapsed_ms`, `mode`, `lifeline`, `tab_hidden_ms` (web) | Every answer, no sampling |
| `duel_round_played` | Server | `duel_id`, `round`, `category`, `correct_count`, `points`, `turn_duration_s` | |
| `duel_completed` | Server | `result` (win/loss/tie/forfeit), `score_self`, `score_opp`, `rating_delta`, `duration_total_s` | One per player |
| `lifeline_used` | Server | `type`, `paid_with` (coins/ad), `mode` | |
| `party_room_created` / `party_joined` | Server | `settings`, `client` (app/web_app/party_client), `player_count` | |
| `party_game_completed` | Server | `players`, `web_guests`, `rank`, `game_id` | One per player |
| `web_guest_install_clicked` | Client | `game_id`, `target` (store/web_app) | Party client → app or web app |
| `pwa_installed` | Client | `prompt` (auto/manual) | Web only |
| `daily_started` / `daily_completed` | Server | `daily_id`, `score`, `streak` | |
| `daily_shared` | Client | `channel` | |
| `question_reported` | Server | `qid`, `reason` | |
| `coins_changed` | Server | `delta`, `reason`, `balance_after` | Every ledger movement |
| `ad_requested` / `ad_shown` | Client | `format`, `placement`, `network` | |
| `ad_paid` | Client | `value_micros`, `currency`, `precision`, `format` | AdMob impression-level revenue (an estimate) |
| `ad_reward_granted` | Server | `format`, `amount` | After SSV (app) or the ad-session check (web) |
| `store_viewed` / `purchase_started` / `purchase_failed` | Client | `sku`, `price_ngn`, `error` | |
| `purchase_completed` / `purchase_refunded` | Server | `sku`, `store` (play/app_store/paystack), `net_kobo` | From RevenueCat and Paystack webhooks |
| `pass_started` / `pass_renewed` / `pass_cancelled` | Server | `plan`, `store` | |
| `push_sent` | Server | `type`, `campaign_id` | |
| `push_received` / `push_opened` | Client | `type` | |
| `experiment_exposed` | Client | `experiment`, `variant` | When a variant first changes what the player sees |
| `consent_changed` | Server | `purpose`, `granted` | |
| `data_saver_toggled` | Client | `on` | |
| `connection_lost` / `connection_restored` | Client | `mode`, `gap_ms` | Network resilience |
| `web_vitals` | Client | `lcp_ms`, `inp_ms`, `cls` | Web only, once per page load |

**Privacy:** no PII in event properties (no phone, no names, no free text), and CI blocks property names on the deny-list. The client never sends its own user ID; ingest adds a pseudonymous `user_pid`. IP addresses are used to estimate the state and then dropped. Core usage (sessions, time spent) and service events run under legitimate interest, documented in the LIA; detailed behaviour (screens, taps, time per screen) needs analytics consent (doc 18 §2.3).

### Tracking plan rules
- The plan lives in `packages/analytics` as typed definitions. Adding an event means a PR that names its owner, purpose, properties and the dashboard that uses it.
- Events are named `object_action` in snake_case; screens are named `area.screen`, so time by mode is time by area.
- Never change what a property means: add a new property or a new event instead.
- Each release candidate gets a tracking check in staging: the test account's actions must appear, in order, on its admin timeline.

## 3. Dashboards (admin console + Grafana)

Product, business and content dashboards live in the admin console ([doc 18 §9](18-admin-console-and-analytics.md)); infrastructure dashboards stay in Grafana. The main ones:

| Dashboard | Audience | Panels |
|---|---|---|
| **Daily pulse** | Whole team | Online now, DAU, WSM, new users, minutes per DAU, D1 of yesterday's cohort, matches, revenue (est.), crash-free, all split by platform |
| **Growth loop** | Growth | Invite funnel (shared → opened → played → signed up → installed), K-factor by channel, web-guest and web-app conversion |
| **Content health** | Content | Reports/1k by category, top-20 reported questions, correct% distribution, d_rating drift, % of pool seen per active user |
| **Economy** | Product | Coin sources vs sinks, coin inflation index, lifeline usage, store conversion |
| **Ads** | Monetisation | Fill rate by network, eCPM by format, rewarded views/DAU, ad-related churn (D7 of users with ≥ 3 interstitials a day) |
| **Network & devices** | Engineering | p95 latency by carrier and state, reconnect rate, cold start by RAM bucket, crash by device model |
| **Integrity** | Trust & safety | Accuracy z-score outliers, timing anomalies, bans, appeals |

## 4. Experimentation framework
- Experiments run on our own flags (admin console › LiveOps › Experiments), each with a pre-registered hypothesis, primary metric, guardrails and minimum detectable effect. Assignment hashes the experiment key with the user ID, so a player gets the same variant on every platform; exposures are logged as `experiment_exposed`. Until the experiments UI ships (v1.1), results are read in Explore.
- **Default guardrails:** D7 retention, crash-free rate, reports/1k, session length.
- Minimum run: 14 days (two full weekly cycles, since Nigerian usage peaks Friday–Sunday).
- **First experiments:**
  1. Taste test with 3 vs 5 questions.
  2. Duel timer 15 s vs 12 s.
  3. Speed bonus visible vs hidden.
  4. First-session push permission timing.
  5. Starter pack price.
  6. Interstitial frequency 3 vs 4.
  7. Daily share text variants (Pidgin vs English).
  8. "Ask Naija" lifeline price.
  9. Random-opponent bot fallback at 30 s vs 60 s.
  10. Home layout: Daily-first vs Duels-first.
  11. Web: a duel invite link opens straight into the turn vs a landing page first.

## 5. Analytics store
- **ClickHouse from day one** holds every event, session, screen time and per-person daily rollup ([doc 08 §6](08-data-model.md), [`schema/analytics.clickhouse.sql`](schema/analytics.clickhouse.sql)). Player and question attributes sync from the Postgres read replica every 5 minutes.
- From v1.1, dbt models on ClickHouse for cohort LTV, content calibration and sponsor reports: `fct_matches`, `fct_answers`, `dim_users`, `dim_questions`, `fct_revenue`, `fct_invites`.
