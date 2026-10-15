# 01 · Research & Market Analysis

**Product:** *Who Sabi?* (working title), a Naija pop-culture trivia game played with friends
**Version:** 1.0 · **Date:** 14 October 2026 · **Status:** Draft for founder review

> Every figure below carries its source. Figures marked *(inferred)* are our own estimates and should be re-checked before they go into a pitch deck.

---

## 1. Executive summary

1. **The audience is big, online and on Android.** Nigeria passed 57% broadband penetration in July 2026 (124.4M broadband subscriptions) and recorded about 157M internet subscriptions in May 2026. Android holds **84%** of mobile OS share, and the phones are mostly Tecno, Infinix and itel. We build for a ₦150k–₦250k Android phone with 3–4 GB RAM first.
2. **Data is cheap enough, but people still count megabytes.** A 30-day 1 GB bundle costs about ₦800 after the 2025 tariff increase. Our budget is **under 1 MB per 10-question match** and **under 25 MB** for the first install.
3. **The social layer is WhatsApp, and culture spreads on TikTok.** WhatsApp is installed on 95% of Nigerian smartphones. TikTok is now the largest social platform in Nigeria, and 66% of urban 18–34s use it regularly. Invites go out over WhatsApp and marketing runs on TikTok.
4. **No one owns "Naija trivia with friends" yet.** Current local players are either cash-prize live shows (Quiz Money, the earlier YTrivia) or once-a-day editorial puzzles (Zikoko's GridLocked). There is no well-made, social, turn-based or party-room trivia game built entirely around Nigerian culture.
5. **The biggest risk is legal, and we can avoid it by design.** Google Play bans games that "accept money in exchange for an opportunity to win a physical or monetary prize." The Supreme Court's November 2024 ruling also moved lottery and gaming regulation to the 36 states. **The game will never take money for a chance at a prize.** It makes money from ads, cosmetics, a subscription and sponsored packs. Any prizes are sponsor-funded and free to enter.

---

## 2. Market sizing

| Metric | Value | Source |
|---|---|---|
| Internet subscriptions | ~157.4M (May 2026) | NCC via Techeconomy |
| Broadband subscriptions / penetration | 124.4M / 57.4% (Jul 2026) | NCC via Techeconomy |
| Internet penetration | 53% record (Jan 2026) | NCC via TechCabal |
| Android share of mobile OS | 84.21% (Sep 2026) | StatCounter |
| iOS share | 15.67% (Sep 2026) | StatCounter |
| Smartphone penetration (12 major cities) | 75% (2025, up from 64% in 2023) | Orange Group & KPMG Nigeria Smartphone Study 2025 |
| WhatsApp install rate on smartphones | 95% | same study |
| TikTok regular use, urban 18–34 | 66%, and 71% of those use it daily | GeoPoll via Brandcom |
| Avg monthly data per MTN user | 14.8 GB (H1 2026) | MTN Nigeria H1 2026 results |
| 1 GB / 30-day bundle | ~₦800 (MTN, Airtel, Glo) | Androidpols, Jan 2026 |
| FX rate | ~₦1,332 / US$ official, ~₦1,375 parallel (Oct 2026) | Techeconomy |

### TAM / SAM / SOM *(inferred)*

- **TAM:** about 100M Nigerian smartphone users. Smartphone users are a large subset of the 157M internet subscriptions, which are counted per SIM, and many people own more than one SIM.
- **SAM:** about 35M urban and peri-urban 16–40 year-olds on Android with at least 3 GB RAM who use WhatsApp daily and follow pop culture.
- **SOM in 24 months:** 1.5M installs and 250k monthly active users (MAU). Ludo and Whot apps from Nigerian developers reach 100k–1M installs with little marketing, so this target is realistic for a well-made social game.

### Nigerian-made games on Google Play (42matters, Feb 2025)
- Nigerian developers have published 199 games and average 115k downloads per game. The **average rating is 1.91★**, which means quality is a real differentiator in this market.
- Monetisation mix: 65% use ads and 27% use in-app purchases (IAP), compared with 74% and 35% globally. IAP is used less in Nigeria, so ads and sponsorships carry more weight.
- Culture-led titles such as Naija Ludo, Naija Whot and Ludo Naira are among the most popular local games.

---

## 3. Audience insights

| Insight | Implication for the product |
|---|---|
| Pop-culture conversation runs on Twitter/X and TikTok and is shared on WhatsApp ("Have you seen…"). | Each match ends with a shareable result card designed for WhatsApp Status and TikTok. |
| People argue about who knows Naija culture best: Lagos vs Abuja, "Ajebo vs Ajepako", Yoruba vs Igbo jollof jokes. | Bragging rights mechanics: head-to-head rivalries, group leaderboards, and a "Who Sabi pass" share card. |
| Phones are shared, storage is tight, and people uninstall when storage runs low. | Small APK, no forced asset downloads, and "lite" image mode. |
| Networks drop in and out, especially in danfo, BRT and campus hostels. | Turn-based async is the core mode. Live rooms must survive a 5–10 second drop. |
| Pidgin and code-switching are normal. | Question copy may use Pidgin. UI language options: English, Pidgin, and later Yoruba, Igbo and Hausa. |
| Distrust of apps that hold money ("I can't withdraw", as one FunBox review says). | No wallet and no cash in v1. If prizes come, they are airtime or data paid out instantly by the sponsor. |
| Students and young professionals are the earliest adopters of games (Ludo, Whot, Codm). | Campus ambassador programme and inter-school leagues. |

### Personas (summary; full versions in the PRD)
1. **Tolu, 22, UNILAG student.** Plays Ludo with hostel mates, active on TikTok, has a Tecno Spark with 4 GB RAM and a ₦1.5k monthly data budget.
2. **Chidi, 29, banker in Abuja.** Two WhatsApp groups (old school and office) where banter is constant. Has an iPhone 12 or a Samsung A-series. Would pay ₦1,000 a month to show off.
3. **Aisha, 34, teacher and mum in Kano.** Wants clean, family-friendly fun and Hausa content. Has an Infinix Hot.
4. **Kemi, 26, works in brand marketing.** Wants a sponsored quiz for an FMCG product launch and pays for reach.

---

## 4. Competitive landscape

| Product | Type | Strengths | Weaknesses / gaps | Lesson for us |
|---|---|---|---|---|
| **Quiz Money** (quizmoney.ng, launched 6 Jun 2025) | Web-based live cash trivia on Fri–Sun at 8pm WAT | No download, Nigerian writers, instant wallet payouts | Fixed schedule, the cash model draws regulatory attention, no "play with your own friends" | A browser join link is a real advantage, so we offer one. Avoid the cash wallet. |
| **YTrivia** ("Nigeria's 1st LIVE quiz gameshow") | HQ-style live show | First mover, local hosts | Has the same problems that killed HQ (see §5) | Do not make a scheduled live show the core. |
| **Zikoko GridLocked** | Daily guessing game, weekdays at 9am, slang, music and film themes | Strong brand voice, daily habit, newsletter distribution | Single player, one puzzle a day, no social play | Proves people want Naija pop-culture puzzles. A daily challenge is a good habit loop. Possible content partner. |
| **FunBox** (iOS/Android) | Whot, Ludo, Chess with video chat | Local games with real-time social play | No trivia, 18+ rating, wallet complaints | Video or voice is optional. Social presence matters. |
| **Naija Trivia (itch.io)** | Hobby civic-quiz game | Novel theme | Tiny reach | Civic content can be a themed pack, not the core. |
| **Trivia Crack / QuizUp (global)** | Turn-based categories, spin-the-wheel | Proven async loop, large user-generated question bank, AdMob-driven | Not local, so Nigerian culture is missing | Copy the async 1v1 loop and the "Question Factory" (user-submitted questions). Trivia Crack grew by localising. |
| **Kahoot / Jackbox** | Party rooms with a code; phones as controllers | Very easy to join in a room | Generic content | Copy the room code plus join-by-link flow for party mode. |

**Positioning:** *"The trivia game that proves who really knows Naija."* It is social first, culture first and fair: no money changes hands, and the winner is whoever really knows.

---

## 5. Lessons from HQ Trivia (ProductMint, Tom's Guide, 9to5Mac)

HQ reached over 700k concurrent players in late 2017 and shut down in February 2020. The causes, and how we avoid each:

| HQ failure | Our counter |
|---|---|
| One format, novelty wore off; HQ Words did not save it | Several modes from launch (async 1v1, party room, daily challenge, group leagues) and a LiveOps calendar |
| Bigger prizes instead of better product | No cash. Status, streaks, cosmetics and sponsored airtime drops |
| Laggy streams, crashes, restarts | No video stream. Questions are text and images under 50 KB, prefetched, with server-authoritative timing |
| Bots answering up to 90% correctly; 9,046 winners splitting a prize | Short answer windows, randomised answer order, question rotation, and server-side anomaly scoring. No cash to cheat for |
| Months-long payout delays | No payouts in v1. Sponsor drops use instant airtime APIs and SLAs |
| Leadership dysfunction | Out of scope for this doc, but noted |

---

## 6. Regulatory scan (not legal advice; confirm with Nigerian counsel)

### 6.1 Gaming, lottery and prizes
- **Supreme Court, 22 Nov 2024** (*AG Lagos State & Ors v. AG Federation & Ors*, SC/1/2008): the National Lottery Act 2005 was nullified, and **states alone may regulate lotteries and games of chance**. Operators face per-state licensing (Mondaq).
- Trivia is a **game of skill**. Risk only appears when users **pay to enter for a chance at a prize** (a "wager").
- **Design rule:** never charge an entry fee for a prize, never sell in-app items that improve prize odds, and never pay cash prizes from users' money. Sponsored prizes are "free to enter, no purchase necessary" and come with official rules shown in the app.

### 6.2 Google Play policy (Real-Money Gambling, Games and Contests)
- Prohibits "games that accept money in exchange for an opportunity to win a physical or monetary prize."
- Prohibits participating with real money, "including in-app items purchased with money", to obtain a prize of real-world value.
- **Implication:** IAP is fine for cosmetics, hints and subscriptions, but **none of it may affect prize eligibility**. Sponsored-prize events must be separate from purchases and have published rules.

### 6.3 Data protection: NDPA 2023 and GAID 2025
- The NDPA General Application and Implementation Directive (GAID) took effect in **September 2025** and replaced the NDPR and its 2020 framework.
- Obligations that apply to us:
  - Appoint a **DPO** (in-house or outsourced).
  - Publish a GAID-compliant privacy policy.
  - Run a **DPIA** before profiling or processing children's data.
  - Do a **compliance audit within 15 months** of starting, then annually.
  - Register with the NDPC if we are a "data controller of major importance" (likely once we pass a meaningful user count, *inferred*).
  - Cross-border transfers (e.g. EU/US cloud) need a lawful basis: adequacy, standard contractual clauses, or another basis.
- **Children:** under NDPA s.31 a child is anyone **under 18**. Their data needs **parental or guardian consent** with age verification. **Decision:** v1 is rated **13+**, users under 18 get a restricted profile (no public chat, no ads personalisation, no prizes), and full accounts are 18+. We will run a DPIA for the under-18 flow.
- **Breach notification:** the NDPA requires notifying the NDPC within **72 hours** of becoming aware of a breach (NDPA s.40). Confirm with counsel.

### 6.4 Consumer and marketing
- Advertising Regulatory Council of Nigeria (ARCON) pre-approval applies to paid ads in Nigerian media. Brief influencers to use the "#ad" disclosure.
- The NCC Do-Not-Disturb (DND) rules affect promotional SMS. Use transactional routes only for one-time passwords (OTP).

---

## 7. Technology & cost context

| Area | Finding | Source |
|---|---|---|
| Devices | Tecno 23.6%, Infinix 21.7%, Samsung 12.4%, Apple 9.4%, Xiaomi 7.2%, itel 5.4% | Intelpoint / StatCounter, Feb 2025 |
| Payments | Paystack 1.5% + ₦100 (flat fee waived under ₦2,500), capped at ₦2,000; Flutterwave ~1.4% | Kolonell, 2026 |
| Google Play in Naira | Verve cards accepted for Play purchases in Naira since Jul 2023 | TechPoint |
| SMS OTP | Local A2P route ~$0.0055–0.008 (₦8–₦12) per SMS | Message Central, 2026 |
| Airtime/data rewards API | Reloadly and VTpass offer developer APIs for Nigerian top-ups | Reloadly, VTpass |
| Cloud | AWS has had a Local Zone in Lagos since Jan 2023. Full regions: af-south-1 (Cape Town) and eu-west | TechCabal, Nairametrics |
| Realtime framework | Colyseus v0.18 scales through Redis presence/driver with rooms pinned to processes | Colyseus docs |
| BaaS | Supabase Pro costs $25/mo with 100k MAU, 8 GB DB and 250 GB egress | Toolradar, 2026 |
| Ads | Rewarded video earns the highest eCPM everywhere. Middle East and Africa eCPMs are low but volume is high, and Android does relatively well there | Appodeal Q4 2024 |

---

## 8. Content landscape: what's hot (for the question bank)

- **Nollywood box office:** *Everybody Loves Jenifa* (2024, ~₦1.88bn) and *A Tribe Called Judah* (2023, ~₦1.40bn) are the top two of all time. Funke Akindele directed or co-directed 4 of the all-time top 10. In 2026, *Call of My Life* (dir. Dammy Twitch) reached ~₦855M by August and is the year's top film. *Ikenga* became the highest-grossing Igbo-language film.
- **Music:** at the 2026 Grammys, Tyla (South Africa) won Best African Music Performance for "Push 2 Start". The other nominees included Burna Boy ("Love"), Davido feat. Omah Lay ("With You") and Ayra Starr feat. Wizkid ("Gimme Dat"). That gives us cross-Africa questions as well as Nigerian ones.
- **Slang:** turns over fast (Zikoko runs a weekly slang GridLocked). A **"Slang Tracker"** process is needed: weekly sweeps of X, TikTok and Zikoko.
- **Food:** evergreen, regional, and good for images: soups, swallows, street food, and the jollof wars.

---

## 9. Key decisions this research supports

1. **Android first** (React Native/Expo also ships iOS from the same code). A **web "join link"** lets a friend play a party round in the browser without installing.
2. **Async turn-based 1v1 and group play is the core.** Live party rooms are second, and the daily challenge drives the habit.
3. **No cash and no wallet.** Monetise with rewarded ads, cosmetics, the "Sabi Pass" subscription and sponsored packs.
4. **Distribution:** WhatsApp sharing, TikTok creators, and campus leagues.
5. **Compliance by design:** 13+ rating, NDPA DPIA, and prize rules kept separate from IAP.

---

## Sources
- [Techeconomy: broadband penetration reaches 57.4%](https://techeconomy.ng/nigerias-broadband-penetration-reaches-574-as-subscriptions-rise-to-1244-million)
- [Techeconomy: internet subscriptions rise to 157.4M](https://techeconomy.ng/nigeria-internet-subscriptions-rise-to-1574-million-as-broadband-penetration-hits-561-in-may)
- [TechCabal: Nigeria's internet hits record 53% in January](https://techcabal.com/2026/03/10/nigerias-internet-hits-record-53-in-january/)
- [StatCounter: Mobile OS share, Nigeria](https://gs.statcounter.com/os-market-share/mobile/nigeria)
- [Intelpoint: Tecno leads phone brands in Nigeria](https://intelpoint.co/insights/tecno-has-the-highest-share-among-phone-brands-in-nigeria-at-23-55-as-of-february-2025/)
- [Brand Spur: WhatsApp installed on 95% of Nigerian smartphones](https://brandspurng.com/2026/09/26/whatsapp-installed-on-95-of-nigerian-smartphones-study-finds/)
- [Brandcom: TikTok is Nigeria's largest social platform](https://brandcom.ng/?p=58214)
- [Androidpols: 1GB data price Nigeria 2026](https://www.androidpols.com.ng/2026/01/1gb-data-price-nigeria-2026-updated.html)
- [MTN Nigeria data usage H1 2026](https://pro.edgex.exchange/it-IT/news/article/mtn-nigeria-monthly-data-usage-h1-2026)
- [42matters: Nigeria mobile game statistics](https://42matters.com/nigeria-mobile-gaming-statistics/)
- [TechCabal: Quiz Money launch](https://techcabal.com/?p=160112)
- [APKCombo: YTrivia](https://apkcombo.com/ytrivia/com.yan.trivia/)
- [Zikoko GridLocked](https://www.zikoko.com/games/gridlocked/gridlocked-26-6-2026/)
- [App Store: FunBox](https://apps.apple.com/ng/app/funbox-whot-multiplayer-game/id6450521939)
- [itch.io: Naija Trivia](https://anyhowanyhow.itch.io/naijatrivia)
- [ProductMint: What happened to HQ Trivia](https://productmint.com/what-happened-to-hq-trivia/)
- [Tom's Guide: HQ pulls the plug](https://tomsguide.com/news/out-of-questions-hq-pulls-the-plug-on-its-trivia-app)
- [AdMob: Trivia Crack success story](https://admob.google.com/home/resources/admob-helps-trivia-crack-go-global-and-reach-over-millions-of-users/)
- [Mondaq: Supreme Court lottery decision](https://www.mondaq.com/regulation-of-lotteries-in-nigeria-review-of-the-supreme-court's-decision-and-its-implications/1589610)
- [CMS: Gambling laws in Nigeria](https://cms.law/en/int/expert-guides/cms-expert-guide-to-gambling-laws-in-africa/nigeria)
- [Google Play: Real-Money Gambling, Games, and Contests policy](https://support.google.com/googleplay/android-developer/answer/9877032?hl=en)
- [Mondaq: GAID 2025 synoptic analysis](https://www.mondaq.com/nigeria/privacy-protection/1620778/synoptic-analysis-of-the-nigeria-data-protection-act-general-application-and-implementation-directive-gaid-2025)
- [KPMG: Review of GAID 2025](https://assets.kpmg.com/content/dam/kpmg/ng/pdf/2025/05/Review%20of%20the%20NDPA%20General%20Application%20and%20Implementation%20Directive%20(GAID)%202025.pdf)
- [UUBO: Personal data of a minor](https://uubo.org/document/personal-data-of-a-minor-what-you-must-know)
- [Kolonell: Paystack vs Flutterwave fees 2026](https://kolonell.com/en/blog/paystack-vs-flutterwave-fees-breakdown-nigeria-2026)
- [TechPoint: Google Play accepts Verve in Naira](https://techpoint.africa/news/nigerian-verve-purchase-apps-google-naira/)
- [Message Central: OTP SMS pricing Nigeria](https://www.messagecentral.com/blog/otp-sms-pricing-nigeria)
- [Reloadly: Nigeria mobile recharge API](https://www.reloadly.com/blog/?p=1603) · [VTpass](https://vtpass.com/)
- [Nairametrics: AWS Local Zone in Lagos](https://nairametrics.com/2023/01/26/aws-launches-new-aws-local-zones-location-in-lagos-nigeria/)
- [Colyseus scalability docs](https://docs.colyseus.io/scalability)
- [Toolradar: Supabase pricing 2026](https://toolradar.com/blog/supabase-pricing-2026)
- [Appodeal: Mobile eCPM report Q4 2024](https://appodeal.com/the-mobile-ecpm-report-updated-q4-2024-view)
- [Intelpoint: 10 highest-grossing Nollywood movies](https://intelpoint.co/blogs/10-highest-grossing-nollywood-movies/)
- [Nairametrics: Call of My Life hits ₦855M](https://nairametrics.com/2026/08/11/call-of-my-life-hits-n855-million-extends-nollywood-box-office-winning-streak/)
- [Nairametrics: Ikenga highest-grossing Igbo film](https://nairametrics.com/2026/09/07/ikenga-crosses-n75-million-becomes-highest-grossing-igbo-film-of-all-time/)
- [Music in Africa: Grammys 2026 Best African Music Performance](https://www.musicinafrica.net/node/382535)
- [Techeconomy: Naira exchange rate, Oct 2026](https://techeconomy.ng/dollar-to-naira-exchange-rate-today-october-12-2026)
