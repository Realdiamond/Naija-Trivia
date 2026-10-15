# 02 · Product Requirements Document (PRD)

**Product:** *Who Sabi?* (working title), Naija trivia with friends
**Owner:** Product lead · **Version:** 1.1 · **Date:** 15 Oct 2026
**Related:** [01 Research](01-research-and-market-analysis.md) · [03 Game Design](03-game-design-document.md) · [06 TRD](06-TRD.md) · [18 Admin Console & Analytics](18-admin-console-and-analytics.md)

> **What changed in 1.1:** a full web app ships alongside the Android and iOS apps (F18, US-11), and the admin console now covers everything players do, with time spent (F16, F17, US-12 to US-14).

---

## 1. Problem statement

Nigerians love arguing about who knows Naija culture best: which Nollywood line came from which film, what a new slang word means, which artist sang a hook, and whose mum's egusi is right. That banter happens on WhatsApp and X, but no game turns it into a fair, fun contest you can play with your own friends.

- Global trivia apps (Trivia Crack, QuizUp clones) don't know Nigerian culture.
- Local trivia products are cash game shows on a fixed schedule (Quiz Money, YTrivia). They carry regulatory and trust baggage and you can't play them with your own people whenever you want.
- Nigerian-made games on Google Play average **1.91★**, so the bar for quality is low.

## 2. Vision

> **"Settle the argument."** *Who Sabi?* is the quickest way to prove you know Naija better than your friends, in a 2-minute async duel or a 10-minute party round in your WhatsApp group, on your phone or in your browser.

## 3. Goals & non-goals

### Goals (12 months after launch)
| # | Goal | Metric | Target |
|---|---|---|---|
| G1 | People play with friends | % of matches with at least one known friend (not random) | ≥ 60% |
| G2 | Growth is viral | K-factor (invites accepted per new user) | ≥ 0.35 |
| G3 | It becomes a habit | D1 / D7 / D30 retention | 40% / 18% / 8% |
| G4 | Sustainable revenue | ARPDAU (average revenue per daily active user) | ≥ ₦6 by month 6, ≥ ₦10 by month 12 including sponsorship (model in doc 11) |
| G5 | Trusted content | Questions reported as wrong per 1,000 answers | < 1.5 |
| G6 | Runs on budget phones | Crash-free sessions on ≤ 3 GB RAM devices | ≥ 99.3% |
| G7 | Play anywhere | Share of new players whose first match is in a browser (web app or party client) | ≥ 25% *(inferred)* |
| G8 | Run on data | KPIs in this PRD visible in the admin console, split by platform, at most 2 minutes old | 100% at launch |

### Non-goals (v1)
- Real-money wagering, entry fees, cash wallets or withdrawals. **Never** (see compliance doc).
- Video or voice chat.
- An open public chat between strangers.
- User-generated questions going live without moderation (submissions are moderated).
- Native desktop apps. Desktop players use the web app.
- Tracking anything outside our own app: other apps, keystrokes, precise location or contacts (doc 18 §2.2).

## 4. Target users & personas

### P1: "Hostel Tolu" (primary)
- 19–24, university student in Lagos, Ibadan, Nsukka, Zaria or Benin.
- Tecno Spark or Infinix Hot, 3–4 GB RAM, about 2 GB of free storage. Buys about 1.5 GB of data a month and sometimes uses night plans.
- Plays Ludo and Whot, watches TikTok for hours, and is in 15+ WhatsApp groups.
- **Jobs to be done:** kill time between lectures, show off, and have fun with roommates.
- **Pains:** data costs, big apps, ads that eat data, and apps that crash.

### P2: "Group Admin Chidi" (primary)
- 25–35, working professional in Lagos, Abuja or PH. Runs or is active in "Class of 2012" and "Office Gist" WhatsApp groups.
- Mid-range Samsung A-series or an iPhone.
- **Jobs to be done:** keep the group lively, organise Friday-night games, banter.
- **Will pay** for a premium look or to host bigger rooms.
- Also plays from a work laptop through the web app.

### P3: "Family Aunty Aisha" (secondary)
- 30–45, teacher or civil servant, often in the North. Wants clean, family-friendly content in Hausa.
- **Needs:** a family-safe filter and later Hausa UI and content.

### P4: "Brand Manager Kemi" (B2B)
- Runs FMCG or telco campaigns and wants measurable engagement with young people.
- **Needs:** a sponsored themed pack (e.g. "Indomie Food Quiz Week"), reach reports, airtime drops.

### P5: "The Ops Team" (internal)
- Founder, content editors, support, growth and the on-call engineer.
- **Jobs to be done:** see who is playing and how, fix a player's problem in minutes, tune the game without a release, show sponsors real numbers.
- **Needs:** one admin console that tracks every player action and minute of play, with safe actions and an audit trail (doc 18).

## 5. Scope

### 5.1 MVP: "Jollof" (launch, about 14 weeks)
| ID | Feature | Priority |
|---|---|---|
| F1 | Phone or Google sign-in, plus guest play | P0 |
| F2 | Profile: username, avatar (preset Naija-styled avatars), home state (optional) | P0 |
| F3 | **Async 1v1 Duel**: 3 rounds × 3 questions, play your turn whenever you like, 48h turn timer | P0 |
| F4 | **Party Room** (live, 2–20 players), room code plus WhatsApp join link; guests can join on the **web without installing** | P0 |
| F5 | **Daily Sabi Challenge**: 7 questions, same set for everyone, resets 00:00 WAT, shareable result grid | P0 |
| F6 | Categories: Slang & Pidgin, Nollywood, Music, Food, plus a "Mixed Naija" bucket | P0 |
| F7 | Scoring with a speed bonus and a streak multiplier; post-match answer review with "Did you know?" facts | P0 |
| F8 | Friends: add from contacts (hashed), by username, or from a past match | P0 |
| F9 | Share cards: match result and daily grid, optimised for WhatsApp Status and TikTok | P0 |
| F10 | Report a question ("wrong answer", "offensive", "outdated") | P0 |
| F11 | Lifelines: 50/50, "Ask Naija" (shows % of players' answers), "Skip"; earned or bought | P1 |
| F12 | Coins (soft currency) from wins, dailies and rewarded ads; spent on lifelines and cosmetics | P1 |
| F13 | Rewarded video ads, plus an interstitial at most every 3 matches (never mid-round) | P1 |
| F14 | Push notifications: your turn, friend joined, daily is live | P0 |
| F15 | Data Saver mode: no images, compressed payloads, no autoplay | P0 |
| F16 | **Admin console**: player search and User 360 (full activity timeline and time spent), live monitor, analytics dashboards, content CMS, LiveOps (Daily, config, flags), moderation, support and compliance tools (doc 18) | P0 |
| F17 | First-party analytics on every platform (every session, screen, answer, match and purchase, with time spent) and crash reporting | P0 |
| F18 | **Web app** at whosabi.ng from the same codebase: guest play, sign-in, duels, party rooms, Daily, practice, friends, profile, settings, share and report; installable (PWA) with web push. Web purchases and ads arrive in v1.1 | P0 |

### 5.2 v1.1: "Suya" (launch + 6 to 10 weeks)
- **Group Leagues:** a persistent group (e.g. a WhatsApp group) with a weekly leaderboard and a bot-style recap link to post in the group.
- **Sabi Pass** subscription: no interstitials, 2× daily coin bonus, exclusive avatar frames, room size up to 50, unlimited duels.
- **Cosmetics shop:** avatar outfits (agbada, ankara, Super Eagles jersey), answer-button skins, victory "gbas gbos" animations.
- **Question Factory:** users submit questions; they are moderated and the author is credited.
- **Audio questions:** 5-second Afrobeats hook clips (licensing dependent) or hummed melody (own recordings).
- **Pidgin UI language.**
- **Web purchases and ads:** Paystack checkout for coins, gems and the Sabi Pass; Google web ads with the same caps as the app.
- **Admin console additions:** push campaigns to segments, the experiments UI, path analysis, scheduled reports, anomaly alerts, and optional session replay (only after a DPIA).

### 5.3 v2: "Pepper Soup" (launch + 4 to 6 months)
- Sponsored packs and events (brand portal), with free-to-enter airtime drops and brand reports from the admin console.
- **Campus Clash:** inter-university leagues and season tournaments.
- Yoruba, Igbo and Hausa UI plus question packs.
- "Throwback" era packs (90s Naija, 2000s Nollywood, old-school Naija TV).
- Spectator mode for party rooms (cast to TV through the web screen).
- Diaspora targeting (UK, US, Canada, Ghana).

## 6. User stories & acceptance criteria (MVP)

### Onboarding
**US-1:** As a new user, I can play my first round within 30 seconds of opening the app, without signing up.
- AC1: First launch goes splash → 3-question "taste test" (one each from Slang, Food, Music) → result → prompt to save progress.
- AC2: Guest progress is kept on the device and merged into the account when the user signs up.
- AC3: Time to first question is ≤ 30 s at p75 on a Tecno Spark 10 (or similar) over 3G.

**US-2:** As a user, I can sign in with phone OTP or Google.
- AC1: OTP is 6 digits, valid for 5 minutes, max 5 sends per number per day, with an SMS fallback to WhatsApp OTP *(optional v1.1)*.
- AC2: Android SMS Retriever API reads the code automatically, with no SMS permission needed.

### Duel (async 1v1)
**US-3:** As a player, I can challenge a friend, a recent opponent or a random opponent to a duel.
- AC1: A duel has 3 rounds. In each round the active player picks 1 of 3 offered categories and both players answer the same 3 questions.
- AC2: The opponent gets a push notification ("Chidi don challenge you! 🔥") and a WhatsApp share link if they aren't on the app.
- AC3: Each turn expires after 48h. On expiry the waiting player wins by forfeit.
- AC4: A player can have up to 20 active duels (free) or unlimited (Sabi Pass).

**US-4:** As a player, I see each question with a 15-second timer, four options and immediate right/wrong feedback.
- AC1: The timer is server-authoritative (see TRD §5). The client shows a countdown that starts once the question has fully rendered.
- AC2: The correct answer is never sent to the client before the player answers (anti-cheat). Tapping an option starts a 250 ms "lock-in" animation while the server checks the answer, and feedback shows within 600 ms at p95 on 3G. In offline Practice mode answers are checked locally, and Practice never affects rating.
- AC3: After the round, the player sees the correct answers and a one-line "Did you know?" fact.

### Party Room (live)
**US-5:** As a host, I can create a room, pick packs and settings, and share a link to my WhatsApp group.
- AC1: The room code is 5 characters from an unambiguous alphabet (no 0/O/1/I). The link format is `https://whosabi.ng/r/ABCDE`.
- AC2: Settings: number of questions (5/10/15/20), categories, timer (10/15/20 s), family-safe on or off.
- AC3: Up to 20 players on free, 50 with Sabi Pass.
- AC4: The host can kick players and lock the room.

**US-6:** As a guest without the app, I can open the link in my browser and play.
- AC1: The web client loads in under 150 KB gzipped on first visit and works on Chrome for Android, Opera (not Mini), Safari, Samsung Internet and the WhatsApp in-app browser. Opera Mini's server-side "Extreme" mode can't hold a WebSocket, so it is detected and shown a "Open in Chrome" prompt.
- AC2: The guest enters a nickname only. After the game they see a "Get the app to keep your score" CTA.

**US-7:** As a live player, if my network drops for up to 10 seconds, I am reconnected to the same game without losing my score.
- AC1: A reconnection token is valid for 60 s. Questions missed while disconnected score 0 but the player is not kicked.

### Daily Sabi Challenge
**US-8:** As a player, I can play today's 7 questions once and share my result grid.
- AC1: Everyone gets the same 7 questions, in the same order, from 00:00 to 23:59 WAT.
- AC2: The share text uses emoji only (🟩🟥⏱) plus a score and a link, so answers aren't spoiled.
- AC3: A streak counter goes up on consecutive days. One free "streak freeze" a week.

### Content quality
**US-9:** As a player, I can report a question in two taps.
- AC1: Reasons: wrong answer, outdated, offensive, typo, too hard or unfair.
- AC2: When a question gets 5 or more "wrong answer" reports, or reports on more than 3% of its answers, it is auto-suspended from rotation pending review.

### Monetisation
**US-10:** As a player, I can watch a rewarded ad to get a lifeline or coins, and I'm never shown an ad mid-question.
- AC1: Rewarded ads are opt-in only. The interstitial cap is 1 per 3 completed matches and never during the first session.
- AC2: Data Saver mode shows ads only on Wi-Fi or when the user opts in.

### Web
**US-11:** As a player without the app, I can open whosabi.ng or any invite link in my browser and play everything the app offers, without installing.
- AC1: Guest play, sign-in, duels, party rooms, the Daily and practice work on the browser matrix in doc 14, with the same rules and scores as the app.
- AC2: A duel invite link opens straight into the challenge, and the invitee can play their turn in the browser.
- AC3: The first screen is interactive in ≤ 6 s at p75 on a low-end Android over 3G, and in ≤ 2 s on repeat visits.
- AC4: Signing in on the web shows the same account, coins, streak and duels as the app.
- AC5: On a computer, I can answer with the keys 1–4 or A–D.

### Admin console
**US-12:** As a support agent, I can find any player and see everything they did and for how long, so I can fix their problem.
- AC1: Search by username, user ID, phone number (permission needed, logged), device ID, duel ID or room code.
- AC2: User 360 shows the full activity timeline grouped into sessions, time spent per day, time by mode, matches with each answer, the ledger, purchases, reports and devices (doc 18 §7).
- AC3: New events appear on the timeline within 2 minutes.
- AC4: Phone numbers and emails stay masked until revealed with a reason, and every view is in the audit log.

**US-13:** As the founder, I can open one page and see what is happening right now, on every platform.
- AC1: The Overview shows players online now (Android / iOS / web), DAU, new players, matches, minutes per DAU and money today against last week, refreshed every 15 s.
- AC2: Every KPI in this PRD has a dashboard, splits by platform, state and acquisition source, and matches the database within ±1%.
- AC3: The Overview and Live pages work on a phone.

**US-14:** As a LiveOps editor, I can change game settings and run experiments without an app release.
- AC1: Config changes show a diff, need a reason, and roll back in one click.
- AC2: A kill switch takes effect for every client within 60 s.

## 7. Functional requirements summary
See [03 Game Design](03-game-design-document.md) for rules, [05 UX](05-UX-and-user-flows.md) for flows, [06 TRD](06-TRD.md) for system behaviour, and [09 API](09-API-and-realtime-protocol.md) for interfaces.

## 8. Non-functional requirements (product-level)
| Area | Requirement |
|---|---|
| App size | Android download ≤ 25 MB (AAB split), install ≤ 60 MB |
| Data per match | ≤ 1 MB for a 9-question duel with images, ≤ 300 KB in Data Saver mode |
| Cold start | ≤ 3 s at p75 on a 3 GB RAM device |
| Live latency | Question broadcast to all clients ≤ 400 ms at p95 within Nigeria |
| Availability | 99.5% monthly (MVP), 99.9% (v2) |
| Accessibility | Text scale up to 200%, colour-blind safe right/wrong states (icon and colour), TalkBack labels |
| Localisation | All strings externalised; English and Pidgin at v1.1 |
| Privacy | NDPA/GAID compliant; contacts hashed on device; no selling of data; tracking limited to our own app, with pseudonymous analytics |
| Web app | Works on the browser matrix (doc 14); first screen ≤ 350 KB gzipped; interactive ≤ 6 s p75 on 3G, ≤ 2 s on repeat visits |
| Admin console | Overview and User 360 load in ≤ 2 s p75; event data at most 2 minutes old; every view and action audited |

## 9. Success metrics & instrumentation
North-star: **Weekly Social Matches (WSM)**, the number of matches completed in a week that involved at least two humans who know each other (friends, a group or a party room).
Supporting metrics: D1/D7/D30, sessions/DAU, matches/DAU, invites sent and accepted, share-card taps, report rate, ARPDAU, rewarded-ad completion rate, subscription conversion.
Full event taxonomy in [13 Analytics](13-analytics-and-metrics.md). Every metric is visible in the admin console ([18](18-admin-console-and-analytics.md)) and splits by platform.

## 10. Release criteria (MVP)
- All P0 stories meet their acceptance criteria in QA on the reference device matrix (see [14 Testing](14-testing-and-QA-plan.md)).
- At least **3,000 approved questions**: ≥ 600 per category plus 600 mixed, with ≥ 30% easy, 50% medium and 20% hard.
- A 2-week closed beta with 500 or more players across 3 campuses gives D7 ≥ 15% and a crash-free rate ≥ 99%.
- Privacy policy, terms, community rules and DPIA signed off.
- Load test passes 5,000 concurrent live players and 50k async duels a day.
- The web app passes every P0 story on the browser matrix (doc 14), including the WhatsApp in-app browser.
- The admin console's MVP modules are live (doc 18 §4), and the Overview's numbers match a direct database count within ±1%.
- The DPIA covers tracking, the admin console and staff access to player data.

## 11. Open questions
| # | Question | Owner | Default if no decision |
|---|---|---|---|
| Q1 | Final brand name and trademark search ("Who Sabi?" vs alternatives such as "Oya Quiz" or "Na Who Sabi") | Founder | Keep "Who Sabi?" and run the trademark search in week 1 |
| Q2 | Music clip licensing (labels vs own recordings) | BD | Launch with text and lyric-based questions, no audio clips |
| Q3 | iOS at launch or after? | Eng lead | Ship both, since Expo makes iOS cheap. Android gets marketing priority |
| Q4 | Under-18 handling | Legal/DPO | 13+ rating with a restricted under-18 mode (see compliance doc) |
| Q5 | Web app address: `whosabi.ng` or `play.whosabi.ng`? | Eng lead | `whosabi.ng`, since every invite link already uses it |
| Q6 | Web purchases at launch or in v1.1? | Founder | v1.1, together with the Sabi Pass |
| Q7 | Session replay in the admin console? | DPO | Off at launch; decide after the DPIA |
