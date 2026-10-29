# 03 · Game Design Document (GDD)

**Version:** 1.1 · **Date:** 15 Oct 2026
**Design pillars:** 1) *Settle the argument* (fair, skill-based, bragging rights) · 2) *Play am anyhow* (async, offline-tolerant, low data) · 3) *E sweet* (fast, funny, full of Naija flavour)

---

## 1. Core loop

```
Open app ──▶ See "Your turn" duels / Daily / Party invite
   │
   ▼
Play a short round (3 questions ≈ 45–60 s)
   │
   ▼
Instant feedback + "Did you know?" + score/streak
   │
   ▼
Reward: coins, XP, streak, rank change
   │
   ▼
Share result / challenge back / invite friend ──▶ Friend plays ──▶ Push "Your turn" ──┐
   ▲                                                                                │
   └────────────────────────────────────────────────────────────────────────────────┘
```

**Session target:** 3–6 minutes, 2–3 sessions a day (morning commute, lunch, night).

---

## 2. Game modes

Every mode plays the same in the Android and iOS apps and in the web app, with the same rules and scoring. Party links can also open in the light web party client.

### 2.1 Duel (async 1v1): the core mode
| Rule | Value |
|---|---|
| Structure | 3 rounds × 3 questions = 9 questions |
| Category pick | Round 1: challenger picks 1 of 3 random categories. Round 2: opponent picks. Round 3: challenger picks (they play it first, and the opponent sees the category before answering) |
| Turn order | A plays round 1 → B plays round 1 and then round 2 → A plays rounds 2 and 3 → B plays round 3. This keeps waiting short |
| Timer | 15 s per question (text), 20 s (image or audio) |
| Turn expiry | 48 h, with reminders at 24 h and 4 h left |
| Ties | Tie-break question: one "closest number" question (e.g. "What year did *Living in Bondage* first come out?"); closest guess wins, then faster answer |
| Opponents | Friend, rematch, or random matchmaking within ±200 rating (widening over a minute), then the Sabi Bot, labelled as a bot, in an unrated duel |

### 2.2 Party Room (live, 2–50 players)
- Host creates a room, picks packs and settings, and shares the link or code.
- Everyone sees the same question at the same moment. The leaderboard shows after every question (top 5 plus your own position).
- **Host screen mode:** the host's phone or a TV in the browser shows the question; players answer on their own phones (Kahoot style).
- **Rounds can include "Wahala Round"** (×2 points, harder questions) as the final 3 questions.
- After the game, the podium plus "MVP of the night" card is shared to the group.

### 2.3 Daily Sabi Challenge (solo, global)
- The same 7 questions for everyone each day, one per category plus a "boss" hard question as #7.
- Results are a Wordle-style emoji grid: `Who Sabi? #142  6/7 ⏱ 58s 🟩🟩🟩🟥🟩🟩🟩 🔥12`
- Nationwide percentile ("You sabi pass 82% of Naija today").
- State leaderboard (opt-in home state): "Anambra dey lead today 👀".

### 2.4 Group League (v1.1)
- A persistent group of 3–100 players, usually mirroring a WhatsApp group.
- Weekly season Monday 00:00 → Sunday 23:59 WAT. Points come from the Daily (score × 10) plus duels against other league members (win = 30).
- The Sunday recap card: "Class of 2012 Week 41: 👑 Chidi, 🥈 Ngozi, 🥉 Femi. Femi still owes us jollof."

### 2.5 Campus Clash (v2)
- Players verify their school with an edu email or ambassador code. School totals come from the average of the top 50 Daily scores. A seasonal trophy, plus sponsor prizes that are free to enter.

### 2.6 Solo Practice / Pack Play
- Play any unlocked pack offline using a cached set of 50 questions. Practice gives XP but no rating change.

---

## 3. Questions

### 3.1 Question types
| Type | Example | MVP? |
|---|---|---|
| Multiple choice (4 options) | "Wetin 'japa' mean?" | ✅ |
| True / False (2 options) | "Jollof rice takes its name from the Wolof people of Senegal. True or false?" (True, and a guaranteed group-chat argument) | ✅ |
| Image MCQ | Picture of a soup → name it | ✅ |
| Finish the line | "Complete the Nollywood line: 'Na you ___'" | ✅ (as MCQ) |
| Emoji riddle | 🍚🔥🎉 → "Party jollof" | ✅ |
| Closest number | "How many states does Nigeria have?" (tie-breaker) | ✅ |
| Audio clip | 5 s Afrobeats intro → song | v1.1 (licence-dependent) |
| Odd one out | "Which is NOT a swallow? Eba, Amala, Moi moi, Semo" | ✅ (as MCQ) |

### 3.2 Difficulty
- Levels 1 (easy) to 5 (expert). The **initial** level is set by the writer. After 200 answers it is **recalibrated automatically** from answer data (see §6.3).
- Duel round composition: 1 easy, 1 medium, and 1 drawn according to the players' combined rating.

### 3.3 Fairness rules
- Answer order is shuffled per player, but both duel players get the same question set.
- A player never sees the same question twice within 30 days. Pool size per category must be 600 or more for this to hold.
- Divisive topics (religion, ethnicity-based jokes, politics, tribal stereotypes) are **out of bounds**. See [04 Content](04-content-strategy-and-question-bible.md).

---

## 4. Scoring

### 4.1 Points per question
```
base       = 100 if correct else 0
speed      = round(100 × (1 − t_answer / t_limit))    // 0–100, only if correct
streak     = min(consecutive_correct − 1, 4) × 20      // 0–80 bonus
wahala     = ×2 in Wahala Round (party only)
points     = (base + speed + streak) × wahala
```
- A single answer is worth at most 280 points (100 + 100 + 80). The maximum for a 9-question duel without lifelines is **2,302**: 900 base, 882 speed (the fastest accepted answer, 300 ms, earns 98) and 520 streak (0 + 20 + 40 + 60 + 5 × 80). `maxScore` in `packages/game-rules` computes it.
- `t_answer` is measured by the server (see TRD §5.3) and clamped to RTT-adjusted bounds.

### 4.2 Rating (matchmaking & bragging)
- **Glicko-2** rating per player, starting at 1500. Separate category ratings help category-strength badges ("Nollywood Oga").
- Leagues by rating tier, with names in Pidgin/English:

| Tier | Rating | Badge |
|---|---|---|
| JJC (Johnny Just Come) | < 1300 | 🐣 |
| Learner | 1300–1499 | 📘 |
| Sharp Guy / Sharp Babe | 1500–1699 | ⚡ |
| Oga | 1700–1899 | 👔 |
| Chairman | 1900–2099 | 🎩 |
| Baba / Mama Sabi | 2100+ | 👑 |

---

## 5. Progression & economy

### 5.1 Currencies
| Currency | Earned | Spent | Notes |
|---|---|---|---|
| **Coins** 🪙 (soft) | Win duel +30, lose or draw +10 (a forfeit earns nothing), Daily +20 (+5 per streak day after the first, max +50 in all), rewarded ad +25, level up +100 | Lifelines, cosmetics, extra duel slots | Cannot be cashed out or traded |
| **Gems** 💎 (hard) | IAP only, plus small Sabi Pass grant | Premium cosmetics, streak repair | **Never** affects prize eligibility (Play policy) |
| **XP** | Every answer: +10 correct, +2 wrong; match complete +50 | – | Unlocks levels (cosmetics, packs) |

### 5.2 Lifelines (max one of each per duel, two per party game)
| Lifeline | Effect | Cost |
|---|---|---|
| 50/50 ✂️ | Removes two wrong options | 60 coins or 1 rewarded ad |
| Ask Naija 📊 | Shows the % of players who chose each option | 80 coins |
| Skip ⏭️ | Swaps in another question from the same category and difficulty | 100 coins |
| Extra Time ⏳ | +10 s | 40 coins |

**Lifelines are disabled in Daily Challenge, Campus Clash and any sponsored-prize event** so those stay fair, and in a duel's tie-break. Extra Time gives more time to answer, not more points: speed points still count against the usual limit. Skip's question is the same category and type, and gets its own clock. Ask Naija shows real players' picks; while a question is new, a stand-in crowd that leans to the right answer (narrowly on hard questions) fills in (build step 2.4b).

### 5.3 Sinks & sources balancing (targets)
- An average free daily player earns about 150 coins a day: 2 duels (+60), Daily (+30), 2 rewarded ads (+50), plus misc.
- Average spend is about 120 coins a day, leaving a small positive balance that motivates cosmetic purchases.
- Prices are tuned with remote config. Review weekly with the analytics dashboard (coin inflation index = coins held / DAU).

### 5.4 Levels & unlocks
- Level curve: XP needed = 200 × level^1.4.
- Unlocks: Level 3 shows Party Room host settings, Level 5 Question Factory, Level 10 custom avatar frame, and every 10 levels a "title" (e.g. "Agba Sabi", "Professor of Gist").

### 5.5 Cosmetics (examples)
- **Avatar outfits:** agbada, aso-oke gele, ankara shirt, NYSC khaki, Super Eagles jersey, Okada rider helmet, Danfo conductor cap.
- **Victory emotes:** "Gbas Gbos", "Shayo time", "E don do", "Ah ahn!"
- **Answer button skins:** Ankara print, Naija flag, Afrobeats neon.
- **Sound packs:** talking drum, Owambe crowd cheer.

---

## 6. Content systems

### 6.1 Packs
- A **pack** is a themed collection of 50–300 questions with a cover image (e.g. "Funke Akindele Universe", "Lagos Traffic Wahala", "Owambe Starter Pack", "Pidgin 101").
- Core packs are free. Premium packs cost 300–600 coins or come with the Sabi Pass. **Sponsored packs** are free to everyone and branded.

### 6.2 Freshness
- Slang and Music categories get **≥ 50 new questions a week**. "Trending" questions expire automatically after 90 days unless renewed.
- Questions with a `valid_until` date (e.g. "current box office #1") are removed from rotation automatically.

### 6.3 Difficulty recalibration (Elo-style item response)
- Each question has a difficulty rating `d_q` (starts from the writer's level: 1 → 1200 … 5 → 1800).
- After each answer: `expected = 1 / (1 + 10^((d_q − r_player)/400))`, `d_q += K × (expected − correct)`, with K = 8.
- Questions are re-bucketed into levels 1–5 nightly by `d_q` quintiles.
- Questions with < 5% or > 97% correct after 300 answers are flagged for editorial review (too hard or too easy, or possibly a wrong answer key).

---

## 7. Social & virality mechanics
| Mechanic | Trigger | Expected effect |
|---|---|---|
| WhatsApp challenge link | "Challenge a friend" → share sheet with preview card | Primary acquisition loop |
| Revenge button | After a loss: "Rematch, I no gree!" | More matches per user |
| Daily emoji grid | After the Daily | Organic reach on Status and X |
| Group League recap | Every Sunday | Brings back lapsed group members |
| "Who Sabi pass?" cards | After beating a friend in a category | Bragging, shown on profile |
| Contact sync | Optional, hashed | Finds friends already on the app |
| Referral reward | Invitee completes the first duel → both get 200 coins | Viral boost (coins only, no cash) |

---

## 8. Tone, voice & audiovisual direction
- **Voice:** a witty Lagos friend. Pidgin sprinkles, never mean, never tribal. Examples:
  - Correct: "Correct! You too sabi 😎" / "Omo, you get am!"
  - Wrong: "Ah ahn! E no reach 😅" / "Wahala dey o"
  - Timeout: "You dey sleep? ⏰"
  - Win: "Na you get am today 👑"
  - Loss: "No vex, next round na your own 💪"
- **Visual style:** bright flat illustrations, a green and white base with sunset orange, Ankara-pattern accents, and big readable type (min 16 sp body).
- **Sound:** short talking-drum stings, crowd "Ehen!" on a streak, under 30 KB each (OGG/Opus), and fully mutable.
- **Animation:** Lottie under 50 KB each, turned off in Data Saver mode or on low-RAM devices.

---

## 9. Anti-frustration & fairness
- A network drop during a duel turn pauses the timer for up to 10 s, then the question is voided and replaced, once per match.
- Bad questions: if a question is later fixed or removed, **points are re-scored** and players get a "We corrected a question" note plus +20 coins.
- Comeback mechanic: none in duels (keeps it fair). In party rooms, the "Wahala Round" ×2 keeps games open.
- Players on a computer answer with the keyboard. Speed and accuracy are compared by platform after the beta; if computers show a systematic edge in ranked play, matchmaking can pair players by input type.

---

## 10. Balancing & tuning parameters (remote config)
Built in step 2.7g: the economy values (duel, Daily and level-up coins, rewarded video coins and cap, ad pacing, lifeline prices) can be changed in the admin console without a release, with history and rollback. Timers, scoring, room sizes and the rest stay as written until their screens can take a change mid-game.

| Key | Default |
|---|---|
| `duel.timer_text_s` | 15 |
| `duel.timer_media_s` | 20 |
| `duel.turn_expiry_h` | 48 |
| `party.max_players_free` | 20 |
| `party.max_players_pass` | 50 |
| `score.speed_max` | 100 |
| `score.streak_step` | 20 |
| `score.streak_cap` | 4 |
| `econ.win_coins` | 30 |
| `econ.rewarded_ad_coins` | 25 |
| `ads.interstitial_every_n_matches` | 3 |
| `content.repeat_window_days` | 30 |
| `difficulty.k_factor` | 8 |
| `web.rewarded_daily_cap` | 5 |
| `web.install_prompt_after_sessions` | 2 |
