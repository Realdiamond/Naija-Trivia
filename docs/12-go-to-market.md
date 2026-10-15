# 12 · Go-To-Market Plan

**Version:** 1.1 · **Date:** 15 Oct 2026
**Positioning:** *Who Sabi? The trivia game that settles the argument.*
**One-liner for the store:** "Prove say you sabi Naija pass your guys. Slang, Nollywood, music and food trivia you can play with friends."

---

## 1. Launch strategy in one paragraph
Seed the game in **3–5 university campuses and 50 WhatsApp groups** during a closed beta. Make every match produce a **shareable artefact**: the duel link, the Daily emoji grid and the podium card. Use **TikTok creators** to turn "Who Sabi?" challenges into a format (street quizzes are already a popular Nigerian TikTok genre). Launch publicly on a **cultural moment** (AMVCA week, Detty December, or the Friday of a big Nollywood release; see §4), and sign a **first sponsor** for a Flash Pack before launch so revenue starts on day one. Every link opens straight into play: in the app if it's installed, otherwise in the **web app**, so nobody has to install anything to answer a challenge.

## 2. Phased plan

| Phase | Dates (relative) | Goal | Key actions | Exit criteria |
|---|---|---|---|---|
| **0. Pre-launch** | W-8 → W-3 | Build a waitlist and content | Landing page with the waitlist + a weekly "Sabi or Not?" quiz post on X and TikTok; recruit 30 campus ambassadors; sign 1 pilot sponsor | 10k waitlist, 3,000 approved Qs |
| **1. Closed beta** | W-3 → W0 | Validate retention and the viral loop | 500–1,000 testers from 3 campuses (UNILAG, UI, UNN) + 50 WhatsApp groups; Play closed testing track and an invite-only web build; weekly feedback calls | D7 ≥ 15%, K ≥ 0.25, crash-free ≥ 99% |
| **2. Soft launch** | W0 → W4 | Tune economy and ads | Open Play listing in Nigeria and the public web app at whosabi.ng; no paid UA; daily content cadence; first party nights with ambassadors | D7 ≥ 18%, ARPDAU ≥ ₦4 |
| **3. Public launch** | W4+ (next cultural moment, §4) | Reach | Creator wave (10–20 creators), PR (TechCabal, Pulse, Zikoko, BellaNaija), "Who Sabi Live" party night with a celebrity host | 100k installs in the first 30 days |
| **4. Scale** | M2 → M6 | Leagues, sponsorships | Group Leagues launch, Campus Clash season 1, 2+ sponsors a month, start the Ghana and diaspora packs | 250k MAU |

## 3. Channels

### 3.1 WhatsApp (core organic loop)
- **Duel invite links** with rich previews (OG image showing the challenger's avatar and "Tolu don challenge you 🔥").
- **Daily grid** designed for WhatsApp Status. The text version fits in one Status line.
- **Group League recap** (v1.1) is an image built for group chats, posted by members.
- **WhatsApp Channel** "Who Sabi Daily", with one teaser question a day linking to the app.
- No WhatsApp Business API messaging to users at launch (cost and consent); revisit for OTP fallback.

### 3.2 TikTok & Instagram Reels (cultural engine)
TikTok is now Nigeria's largest social platform, and 66% of urban 18–34s use it regularly.
- **Formats:**
  1. Street quiz: "Who sabi this slang?" on campus or at Computer Village.
  2. Couple vs couple Party Room.
  3. "Mum vs me" Food round.
  4. Creator duets with "Comment your score".
- **Creator tiers:** 2 macro (> 500k followers) for launch week, 15 micro (20k–200k) recurring monthly. Micro creators often outperform celebrities on TikTok in Nigeria (Brandcom 2026).
- **Budget:** ₦2–4M for launch month, ₦1–2M a month after.
- Every brief: an authentic, entertainment-first hook, "#ad" disclosure, and an app link in the bio with a creator-specific referral code.

### 3.3 X (Twitter)
- Daily "Sabi or Not?" polls, and replies to trending pop-culture moments with a related question.
- Weekly "Hardest question of the week" thread with the % who got it right.

### 3.4 Campus programme
- **Ambassadors:** 2–3 per school. Monthly stipend ₦25k + performance bonus per verified active referral.
- **Activities:** hostel Party Room nights, faculty vs faculty leagues, freshers' week booths (QR codes).
- **Campus Clash** season (v2) with a sponsor-funded trophy and free-to-enter airtime prizes.
- **Target schools (wave 1):** UNILAG, UI, OAU, UNN, UNIBEN, ABU Zaria, UniAbuja, Covenant, LASU, UniPort.

### 3.5 Partnerships
- **Media/content:** Zikoko (GridLocked audience overlap: co-branded "Slang of the Week" pack), Pulse, The Native (music packs), BellaNaija.
- **Radio:** Lagos/Abuja youth stations (e.g. a weekly on-air "Who Sabi?" segment with a live room code).
- **Cinemas:** FilmOne and cinema chains with "What's showing?" packs on release Fridays, and QR codes in the lobby.

### 3.6 App Store Optimisation (ASO)
- **Title:** "Who Sabi? Naija Trivia Quiz". **Short description:** "Slang, Nollywood, music & food trivia. Challenge your friends!"
- **Keywords:** Naija quiz, Nigerian trivia, Nollywood quiz, Afrobeats quiz, Pidgin game, play with friends, Nigeria game.
- **Screenshots:** duel result banter, the Daily grid, a party room with 12 players, category tiles, and "Plays well on any phone · Small download".
- **Feature graphic:** a group of friends with phones in a Lagos street scene, green and orange.
- Localised listing text for en-NG and pcm (when supported).

### 3.7 Paid user acquisition (only after D7 ≥ 18%)
- Google App Campaigns (tCPI), Meta app installs, TikTok App Promotion.
- Target CPI under ₦250 (*inferred*). Kill a channel if D7 for its users is below 12%.
- A lookalike audience built from good players ("completed 5+ duels").

### 3.8 The web app (no install needed)
- **Links open straight into play.** Duel invites, the Daily grid and party links all work in the browser, so the friend who won't install can still answer, then gets asked to save progress and install later.
- **Desktop players.** Office workers can play a quick duel on a work laptop at lunch (the Chidi persona).
- **Search:** public, pre-rendered pages for packs ("Nollywood quiz", "Naija slang quiz", "Afrobeats quiz") and the Daily teaser.
- **Measure it** in the admin console: web first visits, web → account, web → app installs, and D7 retention by platform. If web players retain far below app players, push install prompts harder after a player's first win.

## 4. Launch calendar options
| Option | Why | Risk |
|---|---|---|
| **Detty December (1 Dec)** | Peak social season, IJGB and diaspora at home, groups active | Noisy period, higher CPMs |
| **AMVCA or Headies week** | Natural fit with Nollywood and music packs | Event dates move |
| **Independence Day (1 Oct)** | National identity theme | Next one is a year away |

**Recommendation:** with a 2 November 2026 kickoff, the roadmap (doc 15) reaches soft launch in early March 2027. Make the **public launch push for AMVCA week 2027** (dates TBC, historically around May) with a Nollywood-heavy pack, using the extra weeks of soft launch to tune retention. Then treat **Detty December 2027** as the first big seasonal push with Group Leagues live. If the build starts by mid-July instead, a Detty December launch is possible.

## 5. Community & moderation
- Official Discord or Telegram for super-fans (question submitters, ambassadors).
- Weekly "Question Court": the community votes on disputed answers. It builds trust and produces content.
- Clear community rules: no tribalism, no harassment. Enforcement is in the compliance doc.

## 6. Launch KPIs dashboard
| KPI | Target (first 30 days) |
|---|---|
| Installs | 100k |
| D1 / D7 | 40% / 18% |
| Invites sent per new user | ≥ 1.5 |
| Invite acceptance rate | ≥ 25% |
| Daily share rate (of Daily finishers) | ≥ 15% |
| Store rating | ≥ 4.4★ |
| Sponsor deals signed | ≥ 1 |
| Share of new players whose first match is in a browser | ≥ 25% |
| Web → account conversion (web players who finish a match) | ≥ 30% *(inferred)* |

## 7. Budget (first 3 months, *inferred*)
| Item | ₦ |
|---|---|
| Creators (launch wave + monthly) | 8,000,000 |
| Campus ambassadors (30 × ₦25k × 3 + bonuses) | 3,000,000 |
| Events and party nights (venue, MC, merch) | 2,500,000 |
| PR and ARCON vetting | 1,000,000 |
| Paid UA test budget | 3,000,000 |
| Design assets (illustrations, video edits) | 1,500,000 |
| **Total** | **≈ ₦19M (~US$14k)** |
