# 13 · Analytics, Metrics & Experimentation

**Version:** 1.0 · **Date:** 14 Oct 2026 · **Tools:** PostHog (product analytics, flags, experiments), Firebase Analytics (ads attribution), Sentry (stability)

---

## 1. Metric tree

```
North star: Weekly Social Matches (WSM)
= matches completed per week involving ≥ 2 humans who know each other (friends, league, party room)
│
├── Acquisition: installs, invite-link opens, invite→install conversion, web-guest→install conversion
├── Activation: % new users who finish the taste test; % who complete 1st duel within 24h; % who add ≥1 friend
├── Engagement: matches/DAU, sessions/DAU, Daily completion rate, avg questions/session
├── Retention: D1/D7/D30, weekly cohort retention, streak distribution
├── Virality: K-factor = invites sent/user × acceptance rate; shares/DAU
├── Monetisation: ARPDAU, rewarded views/DAU, payer conversion, ARPPU, pass conversion & churn
└── Quality: crash-free sessions, p95 serve→answer latency, reports/1k answers, OTP success rate
```

## 2. Event taxonomy (naming: `object_action`, snake_case)

Common properties on every event: `user_id`, `anon_id`, `session_id`, `platform`, `app_version`, `device_model`, `ram_mb`, `network_type` (wifi/4g/3g/2g/offline), `carrier` (MTN/Airtel/Glo/T2), `data_saver`, `language`, `age_band`, `home_state` (if set), `ts`.

| Event | Key properties | Notes |
|---|---|---|
| `app_opened` | `cold_start_ms`, `source` (push/deeplink/organic) | |
| `taste_test_completed` | `correct_count`, `duration_ms` | FTUE |
| `signup_completed` | `method` (phone/google/apple), `merged_guest` | |
| `otp_sent` / `otp_verified` / `otp_failed` | `provider`, `carrier`, `latency_ms`, `reason` | OTP health |
| `friend_added` | `source` (contacts/username/opponent/link) | |
| `invite_shared` | `channel` (whatsapp/status/x/copy/other), `context` (duel/party/daily/profile) | |
| `invite_opened` | `type`, `has_app`, `platform` | From the link service |
| `duel_created` | `opponent_type` (friend/random/link/rematch/bot) | |
| `duel_round_played` | `duel_id`, `round`, `category`, `correct_count`, `points` | |
| `duel_completed` | `result` (win/loss/tie/forfeit), `score_self`, `score_opp`, `rating_delta`, `duration_total_s` | |
| `question_answered` | `qid`, `category`, `difficulty`, `correct`, `accepted_elapsed_ms`, `mode`, `lifeline` | Sampled at 20% in prod (full data is in the DB) |
| `lifeline_used` | `type`, `paid_with` (coins/ad), `mode` | |
| `party_room_created` / `party_joined` | `settings`, `client` (app/web), `player_count` | |
| `party_game_completed` | `players`, `web_guests`, `rank`, `game_id` | |
| `web_guest_install_clicked` | `game_id` | Web-to-app conversion |
| `daily_started` / `daily_completed` | `daily_id`, `score`, `streak` | |
| `daily_shared` | `channel` | |
| `question_reported` | `qid`, `reason` | |
| `ad_requested` / `ad_shown` / `ad_rewarded` | `format`, `placement`, `network`, `ecpm_bucket` | |
| `store_viewed` / `purchase_started` / `purchase_completed` / `purchase_failed` | `sku`, `price_ngn`, `error` | |
| `pass_started` / `pass_renewed` / `pass_cancelled` | `plan` | From RevenueCat webhooks |
| `push_received` / `push_opened` | `type` | |
| `data_saver_toggled` | `on` | |
| `connection_lost` / `reconnected` | `mode`, `gap_ms` | Network resilience |

**Privacy:** no PII in event properties (no phone, no names). User IDs are internal ULIDs. IPs are truncated at ingestion. Events are only sent after analytics consent; a minimal set of service events runs under legitimate interest, documented in the LIA.

## 3. Dashboards (PostHog + Grafana)

| Dashboard | Audience | Panels |
|---|---|---|
| **Daily pulse** | Whole team | DAU, WSM, new users, D1 of yesterday's cohort, matches, revenue (est.), crash-free |
| **Growth loop** | Growth | Invite funnel (shared → opened → installed → first match), K-factor by channel, web-guest conversion |
| **Content health** | Content | Reports/1k by category, top-20 reported questions, correct% distribution, d_rating drift, % of pool seen per active user |
| **Economy** | Product | Coin sources vs sinks, coin inflation index, lifeline usage, store conversion |
| **Ads** | Monetisation | Fill rate by network, eCPM by format, rewarded views/DAU, ad-related churn (D7 of users with ≥ 3 interstitials a day) |
| **Network & devices** | Engineering | p95 latency by carrier and state, reconnect rate, cold start by RAM bucket, crash by device model |
| **Integrity** | Trust & safety | Accuracy z-score outliers, timing anomalies, bans, appeals |

## 4. Experimentation framework
- Use PostHog experiments with a pre-registered hypothesis, primary metric, guardrails and minimum detectable effect.
- **Default guardrails:** D7 retention, crash-free rate, reports/1k, session length.
- Minimum run: 14 days (two full weekly cycles, since Nigerian usage peaks Friday–Sunday).
- **First 10 experiments:**
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

## 5. Data warehouse (from v1.1)
- Nightly export of Postgres (read replica) and PostHog to **BigQuery** (or ClickHouse) for cohort LTV, content calibration and sponsor reports.
- dbt models: `fct_matches`, `fct_answers`, `dim_users`, `dim_questions`, `fct_revenue`, `fct_invites`.
