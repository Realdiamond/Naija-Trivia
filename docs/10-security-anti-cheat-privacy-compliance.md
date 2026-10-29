# 10 · Security, Anti-Cheat, Privacy & Compliance

**Version:** 1.1 · **Date:** 15 Oct 2026 · *1.1 adds the web app, the admin console and first-party tracking*
> This is an engineering and product view of the obligations, not legal advice. Before launch, have a Nigerian data-protection lawyer and a gaming/advertising lawyer review §4 and §5.

---

## 1. Threat model (STRIDE summary)

| Asset | Threat | Mitigation |
|---|---|---|
| Accounts | OTP abuse (SMS pumping / toll fraud), credential stuffing | Per-number, per-device and per-IP limits; WAF bot control; CAPTCHA (Turnstile) after 2 sends; allow only +234 numbers at launch; alert on OTP send-to-verify ratio below 40% |
| Sessions | Token theft or replay | Short-lived ES256 access tokens, rotating refresh tokens with reuse detection, device binding, TLS 1.2+ only, certificate pinning on mobile (with a backup pin) |
| Game integrity | Answer lookup, bots, timing manipulation, collusion | See §2 |
| Economy | Coin duplication, fake ad rewards, IAP fraud | Double-entry ledger, idempotency keys, AdMob SSV only, RevenueCat server validation, nightly balance reconciliation |
| Content | Malicious edits in the admin console | SSO + RBAC, two-person approval to go live, audit log, versioning |
| Web app | XSS, CSRF, token theft in the browser, malicious extensions | Strict Content Security Policy; player text never rendered as HTML; access token in memory only; HttpOnly, SameSite=Strict refresh cookie with CSRF header and Origin checks (TRD FR-AUTH-7); Subresource Integrity on third-party scripts |
| Question bank | Scraping by playing at scale (any platform) | Serve rate limits per user, device and IP; daily limits for guests; Turnstile on web guest creation; the integrity job flags accounts answering hundreds of questions an hour (`question_scraping`) |
| Admin console & tracking data | Staff misuse of player data; admin account takeover | SSO with enforced 2-step verification (security keys for privileged roles), least-privilege roles, PII masked by default, reveal with a reason, every view and action audited, watermarked exports, quarterly access review (doc 18 §16) |
| Web ads (v1.1) | Fake rewarded-ad claims (web ads have no server-side verification) | Server-issued one-time ad sessions, minimum view time, cap of 5 rewards a day, signed-in players only |
| Users | Harassment through usernames or nicknames | Profanity filters (EN, Pidgin, Yoruba, Igbo, Hausa), report and block, no free-text chat in v1 (emoji reactions only) |
| Infrastructure | DDoS, injection, SSRF | CloudFront + WAF + Shield Standard, parameterised queries, Zod validation, no user-supplied URLs fetched server-side |
| Data | Breach, insider access | Encryption at rest (RDS/KMS), least-privilege IAM, PII access only through audited support tools, quarterly access review |

### Secure SDLC
- Dependency scanning (Dependabot, `pnpm audit`), SAST (Semgrep), secrets scanning (gitleaks) in CI.
- Mobile: obfuscation through Hermes bytecode and R8, and jailbreak/root detection used only as a **risk signal**, since many Nigerian phones are rooted or run custom ROMs, so we don't block them.
- An external penetration test before public launch, then yearly. A bug bounty (private, on HackerOne or Intigriti) from v1.1.

## 2. Anti-cheat design

HQ Trivia showed that cheating destroys trivia economies, with bots answering 90% correctly. With **no cash at stake** the incentive is smaller, but leaderboards, campus clashes and sponsor drops still need protection.

| Cheat | Detection / prevention |
|---|---|
| Googling answers | 15 s timer. Questions revealed one at a time. Many questions are culturally nuanced and hard to search quickly. Speed bonus rewards instant recall |
| Reading answers from app memory or network | The correct index is never sent before the answer. Per-player shuffled options |
| Screen-reader / OCR bots | Statistical detection: accuracy above 95% with a near-constant response time across hard questions → shadow flag. Compare player accuracy against question difficulty (`d_rating`) using a z-score |
| Timing manipulation (fake `client_elapsed`) | Server clamp (TRD §5.3). Raw values stored. Flag when client elapsed is consistently far below server elapsed minus RTT |
| Multi-accounting / smurfing | Device fingerprint (install ID, model, ram), phone verification for ranked play and Campus Clash, one prize claim per phone number and per device |
| Collusion in duels (win-trading) | Rating gains between the same pair are dampened after 3 games in 24 h. Graph analysis for rings |
| Party room shared screen | Accepted: it's a party game, and party results don't affect rating |
| Modified APK | Play Integrity API verdict checked on login and before ranked or prize events (risk score, not a hard block) |
| Searching in another browser tab (web) | Time with the tab hidden during each question (`tab_hidden_ms`) feeds the integrity score; speed and accuracy are compared by platform. Never an automatic ban |
| Scripted play in a desktop browser | Turnstile at guest creation, the same server-side timing clamp, accuracy-vs-difficulty z-scores. Play Integrity doesn't exist on the web, so ranked play and prize events need a phone-verified account |

**Enforcement ladder:** shadow-exclude from leaderboards → warning → ranked ban (30 days) → permanent ban. Every action is logged in `moderation_actions` with an appeal route through support (`help@whosabi.ng`). Built in step 2.7d: moderators take each step from User 360; bans longer than 30 days or for good need an admin. Built in step 2.7e: the nightly checks for accuracy against difficulty, faked clocks and searching in another tab, which raise flags for moderators.

## 3. Privacy by design (NDPA 2023 + GAID 2025)

### 3.1 Data inventory (record of processing)
| Data | Purpose | Lawful basis | Notes |
|---|---|---|---|
| Phone number | Login, fraud prevention | Contract | Stored as an E.164 identity. Hash used for discovery |
| Email address | Login by email code (if chosen) | Contract | Stored as the identity, lower-cased. Masked for staff (`c•••@gmail.com`); sent to Resend only to deliver a code |
| Google/Apple ID | Login | Contract | Only `sub` and email (if provided) |
| Username, avatar, home state | Profile, leaderboards | Contract / consent (state optional) | Home state is optional |
| Age band | Child protection | Legal obligation | Never the exact date of birth |
| Gameplay and answers | Game service, fairness | Contract / legitimate interest | Raw timing kept for 180 days |
| Contacts (prefixes only) | Find friends | Consent | Raw contacts never leave the device |
| Device info, push token | Service delivery | Contract | |
| Advertising ID | Ads personalisation | **Consent** (Google UMP consent flow) | Non-personalised ads by default for 13–17 |
| Analytics events | Product improvement | Consent / legitimate interest (LIA documented) | First-party, stored in ClickHouse in our AWS region under a pseudonymous ID |
| Sessions, screens and time spent | Running the service, product improvement, fair play | Legitimate interest for core usage (sessions, time spent); consent for detailed behaviour (screens, taps, time per screen) | Raw events 13 months, rollups 25 months (doc 18 §2) |
| Approximate state from IP | Regional stats, fraud signals | Legitimate interest (LIA) | The IP is discarded at ingest; only the state is kept |
| Web storage and cookies | Session, consent choice, offline queue; analytics only with consent | Strictly necessary / consent | Cookie and consent banner on the first visit |
| Staff access records | Accountability for staff access to player data | Legal obligation | `admin_audit_log`, kept 6 years |
| Purchase records | Billing, refunds | Contract / legal obligation | Via store/RevenueCat, and Paystack on the web (v1.1); no card data touches us |

### 3.2 Obligations checklist
- [ ] Appoint a **Data Protection Officer** (outsourced DPO or DPCO is fine at seed stage).
- [ ] **Privacy policy** meeting GAID disclosure requirements (in-app + web), plus a **child-friendly summary** for 13–17s.
- [ ] **DPIA** before launch, covering processing of minors' data, profiling (ratings, anti-cheat flags), contact discovery, ads, behavioural tracking and time-spent analytics, and staff access to player data through the admin console.
- [ ] **Legitimate Interest Assessment** for core usage analytics (sessions and time spent), anti-cheat and the approximate state from IP.
- [ ] **Consent management:** granular toggles (marketing push, ads personalisation, contacts, analytics), plus the cookie banner on the web, all logged in `consent_records`.
- [ ] **Staff access controls:** role-based access, PII masked by default, reveal with a reason, and an audit entry for every view of a player's data in the admin console; quarterly access review (doc 18 §16).
- [ ] **Data subject rights:** access, rectification, erasure, portability and objection through in-app settings; 30-day SLA tracked in `dsar_requests`.
- [ ] **Cross-border transfer:** AWS (UK/EU/ZA), ClickHouse Cloud (if used rather than self-hosting), Sentry and RevenueCat (US) all need standard contractual clauses or another GAID-recognised mechanism, documented in a transfer register.
- [ ] **Registration with the NDPC** once the "data controller of major importance" thresholds are met. Check the current thresholds and fee tier at launch and re-check every quarter.
- [ ] **Compliance audit** within 15 months of starting, then a yearly Compliance Audit Return through a licensed DPCO (deadline 31 March each year).
- [ ] **Breach response:** notify the NDPC within **72 hours** of becoming aware, and notify affected users without undue delay when there is high risk (NDPA s.40). Run a tabletop exercise before launch.
- [ ] **Vendor DPAs** with every processor: AWS, Termii, Africa's Talking, Google (Firebase/AdMob, and web ads from v1.1), RevenueCat, ClickHouse Inc. (if ClickHouse Cloud), Sentry, Paystack (v1.1), Reloadly/VTpass.
- [ ] **Data minimisation:** no exact birthdays, no location beyond optional state, no contact upload.

### 3.3 Children (13–17)
NDPA s.31 defines a child as anyone **under 18** and requires **parent or guardian consent** with age verification that fits the available technology.

**Product decision:**
1. Under 13: blocked at the age gate.
2. 13–17 → **restricted account**:
   - Guardian consent captured through a guardian phone OTP (a guardian enters their number, receives an OTP and confirms consent). Logged as `consent_records.purpose='guardian'`.
   - No ads personalisation, no Question Factory submissions, no prize events, no public leaderboard name (shown as "Player from Lagos"), friends only through codes or links (not discoverable by contacts), and family-safe content only.
   - Tracked for the service and for safety only: never in marketing segments, push campaigns, price experiments or session replay.
3. 18+: full account.
- Google Play: complete the **Target Audience & Content** form honestly (13+). Don't select "children" age groups, so the app stays out of Designed-for-Families requirements. Ads SDKs are configured with `tagForUnderAgeOfConsent` for 13–17.

## 4. Gaming, prizes & promotions compliance

### 4.1 Rules we follow everywhere
1. **No paid entry for prizes.** No mode where coins, gems or money buy a chance at a prize.
2. **IAP can't buy prize eligibility or prize odds.** Lifelines are disabled in prize events, and purchases are never checked in prize eligibility code (enforced by the `purchase_independent` CHECK).
3. **Prizes are sponsor-funded, free to enter, skill-based** (top scores in a fixed question set), with official rules published (eligibility 18+, dates, prize, how winners are chosen, tie-breaks, excluded states if counsel advises).
4. **No cash wallet.** Prizes are delivered as airtime or data top-ups to the verified phone number, or as physical merch.
5. **No chance mechanics tied to real value.** No loot boxes with real-money purchase; cosmetic loot (if ever) shows its odds and stays cosmetic-only.

### 4.2 Why
- **Google Play policy** (Real-Money Gambling, Games and Contests) bans "games that accept money in exchange for an opportunity to win a physical or monetary prize" and participation with "in-app items purchased with money" to obtain real-world prizes.
- **Nigeria:** since the Supreme Court ruling of 22 Nov 2024, lotteries and games of chance are regulated by **each state** (e.g. Lagos State Lotteries and Gaming Authority). A free-entry skill contest sits outside "lottery" and "gaming" definitions in most regimes, but **counsel must confirm** for Lagos, FCT, Oyo, Rivers and Kano before the first prize event, and the event rules can exclude states if needed.
- **Sales promotions:** brand-sponsored promotions may need approval from the relevant state lottery or gaming authority, or the Federal Competition and Consumer Protection Commission (FCCPC), depending on structure. The brand partner usually owns that compliance; our contract template says so.

## 5. Advertising & marketing compliance
- **ARCON:** ads placed in Nigerian media (including digital and influencer content) need ARCON vetting. Budget time and fees into campaigns.
- **Influencers:** a contract clause requires "#ad" or "#sponsored" disclosure.
- **SMS:** OTP only, on a transactional route. No promotional SMS without opt-in, respecting NCC DND rules.
- **Ad content filters:** block gambling, betting, alcohol (for under-18s), dating, crypto and political categories in AdMob for all users. Blocking betting ads protects the brand, since the game must not look like a betting app.

## 6. App store compliance checklist
- [ ] Play Data Safety form matches the §3.1 inventory.
- [ ] Target audience 13+, content rating via IARC (expect "Teen"/PEGI 12 because of mild references; family-safe filter available).
- [x] Account deletion available in-app **and** via a web URL (a Google Play requirement). The web app provides the URL: `https://whosabi.ng/delete-account` (step 2.8a).
- [ ] Web purchases (v1.1) are never mentioned or linked inside the Android and iOS apps (store anti-steering rules); re-check the rules before launch.
- [ ] Web: cookie and consent banner, privacy policy and terms available on whosabi.ng.
- [ ] Subscription disclosure: price, period, auto-renew, and how to cancel, shown before purchase.
- [ ] iOS: Sign in with Apple offered alongside Google, App Tracking Transparency prompt before IDFA use.
- [ ] Permissions: no READ_SMS (use the SMS Retriever API); contacts requested only at "Find friends".

## 7. Incident response (summary)
| Severity | Example | Response |
|---|---|---|
| SEV1 | Data breach (including staff misuse of player data), total outage | On-call paged within 5 min; incident commander assigned; DPO informed within 2 h; NDPC notified within 72 h if personal data is affected; user comms |
| SEV2 | Party rooms down, OTP failing on one network | Page on-call; status banner in app; fail over SMS provider |
| SEV3 | A wrong question is live | Content on-call suspends it; re-score job; apology note + coins |

Runbooks live in `/docs/runbooks`. Post-incident reviews within 5 working days, blameless format.
