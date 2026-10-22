# 17 · Risk Register

**Version:** 1.1 · **Date:** 15 Oct 2026 · Scale: Likelihood (L) and Impact (I) from 1 (low) to 5 (high); Score = L × I

| # | Risk | L | I | Score | Mitigation | Owner | Trigger to watch |
|---|---|---|---|---|---|---|---|
| R1 | **Content runs dry or goes stale** (novelty fades, HQ-style) | 4 | 5 | 20 | 3,000 Qs at launch, 100+/week pipeline, Question Factory, several modes, LiveOps calendar | Content lead | % of pool seen by median D30 user > 60% |
| R2 | **Wrong or offensive question goes viral** (tribal/religious misstep) | 3 | 5 | 15 | Two-person fact-check, regional sensitivity reviewers, auto-suspend thresholds, fast apology + correction flow | Editor | Report spikes; social mentions |
| R3 | **Regulatory: prize events seen as gaming/lottery** by a state authority | 2 | 5 | 10 | No paid entry ever, sponsor-funded free entry, official rules, counsel opinion per key state, state exclusions | Founder + counsel | Any regulator letter; new state gaming laws |
| R4 | **Google Play policy strike** (gambling/contests, data safety, families) | 2 | 5 | 10 | Compliance checklist (doc 10 §6), no IAP-to-prize link, accurate Data Safety form, pre-launch policy review | Product | Play Console warnings |
| R5 | **Low retention** (fun once, not habit) | 3 | 5 | 15 | Async duels with friends, Daily streaks, leagues; strict beta exit criteria before spending on UA | Product | D7 < 15% in beta |
| R6 | **Weak virality** (people don't invite) | 3 | 4 | 12 | Invite at natural moments (rematch, Daily share), rich WhatsApp previews, referral coins, web join without install | Growth | K < 0.2 |
| R7 | **Low ad revenue** (Nigerian eCPMs volatile) | 4 | 3 | 12 | Mediation, rewarded-first, sponsorship as primary B2B line, Sabi Pass | Monetisation | ARPDAU < ₦4 for 4 weeks |
| R8 | **Network/latency problems** ruin live games | 3 | 4 | 12 | Async-first design, latency-tolerant timing, reconnection, Lagos probes, region choice based on data | Tech lead | Reconnect rate > 5% of sessions |
| R9 | **Low-end device performance** (crashes, ANRs on 2–3 GB phones) | 3 | 4 | 12 | Device lab, Hermes, lazy loading, Data Saver, performance budgets in CI | Mobile eng | Crash-free < 99% on low tier |
| R10 | **SMS OTP fraud / SMS pumping** costs | 3 | 3 | 9 | +234-only, rate limits, CAPTCHA, send/verify ratio alerts, Google sign-in alternative | Tech lead | OTP cost > ₦150k/week unexpectedly |
| R11 | **Copyright claims** (lyrics, audio, film stills) | 2 | 4 | 8 | Facts not content, ≤ 6-word quotes, licensed or own-illustrated images, audio only with licences | Content lead | Takedown notice |
| R12 | **Cheating undermines leaderboards / prizes** | 3 | 3 | 9 | Server-authoritative timing, no answers on client, anomaly detection, Play Integrity, phone verification for prize events | Tech lead | Accuracy z-score outliers |
| R13 | **Data breach / NDPA non-compliance fine** | 2 | 5 | 10 | DPO, DPIA, encryption, least privilege, pen test, 72-hour breach plan, vendor DPAs | DPO | Audit findings |
| R14 | **Competitor copies** (Quiz Money adds friend play, or a global app localises) | 3 | 3 | 9 | Speed of content and community, brand voice, leagues/campus network effects, sponsor relationships | Founder | Competitor feature launches |
| R15 | **Name/trademark conflict** ("Sabi" is used by other Nigerian brands) | 3 | 3 | 9 | Trademark search in week 1; backup names ready ("Na Who Sabi", "Oya Quiz", "Gbas Gbos Trivia") | Founder | Search results / objections |
| R16 | **FX & cost inflation** (USD-billed infra, tools) | 3 | 3 | 9 | Lean infra, reserved instances once stable, Naira revenue lines, budget in USD with buffer | Founder | ₦/US$ moves > 10% |
| R17 | **Key-person dependency** (one content lead) | 3 | 3 | 9 | Documented style guide + CMS workflow, 2nd editor by v1.1 | Founder | – |
| R18 | **Minors' data mishandled** | 2 | 5 | 10 | Age gate, restricted mode, guardian OTP consent, no ads personalisation for 13–17, DPIA | DPO | Complaints; audit |
| R19 | **Web players don't stick** (no push on iPhone, a browser tab is easy to forget) | 3 | 3 | 9 | Web push on Android, install prompts after wins, WhatsApp nudges, retention by platform in the admin console | Growth | Web D7 below 60% of app D7 |
| R20 | **Admin and analytics scope creep delays launch** | 3 | 4 | 12 | Fixed MVP module list (doc 18 §4), Metabase for the long tail, a dedicated data & admin engineer | Tech lead | Admin work slipping past S6 |
| R21 | **Staff misuse of player data** through the admin console | 2 | 5 | 10 | Least-privilege roles, PII masked by default, reveal with a reason, every view audited, quarterly access review, pseudonymous analytics | DPO | Unusual reveal or export volume |
| R22 | **Web cheating** (searching in another tab, scripted desktop play) | 3 | 3 | 9 | Tab-hidden signal, timing clamp, accuracy z-scores by platform, phone verification for ranked and prize play | Tech lead | Web accuracy or speed well above app on hard questions |

## Top 5 to review every sprint
R1 content freshness · R5 retention · R2 sensitive-content misstep · R6 virality · R7 revenue

## Assumptions log (to validate in beta)
| # | Assumption | How to validate |
|---|---|---|
| A1 | Friends will play async duels several times a week | Beta: duels/user/week ≥ 5 |
| A2 | WhatsApp link previews drive installs | Invite open → install ≥ 20% |
| A3 | Web guests convert to an account or an install after a party | Web guest → account or install ≥ 10% |
| A4 | Users accept rewarded ads for lifelines | Rewarded views/DAU ≥ 1.2 |
| A5 | Brands will pay ₦1.5–3.5M for packs | 3 sponsor conversations → 1 signed pilot pre-launch |
| A6 | 15 s timer is right for Nigerian networks and reading speed | Timeout rate per question < 12% |
| A7 | Pidgin copy increases sharing | Experiment: Pidgin vs English share text |
| A8 | Invitees who can play straight away in the browser accept more duels | Experiment 11 (doc 13): acceptance with web play ≥ 1.3× the landing-page variant |
| A9 | Players on computers have no systematic edge | Accuracy and speed on the same questions within 5% across platforms |
