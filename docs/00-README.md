# Who Sabi? (working title): Naija Trivia with Friends
### Complete product & build documentation pack · v1.0 · 14 October 2026

> **The idea in one line:** a fast, fair trivia game about Nigerian slang, Nollywood, music and food that you play with your own friends, as async duels, live party rooms from a WhatsApp link, or a shareable daily challenge.

---

## How to use this pack
Read **01 → 03** to understand *why* and *what*. Engineers start at **06 → 09**. Founders and growth leads should read **10–12** and **15** before spending money.

| # | Document | What's inside | Main reader |
|---|---|---|---|
| 00 | README (this file) | Index, summary, key decisions | Everyone |
| 01 | [Research & Market Analysis](01-research-and-market-analysis.md) | Market size, audience, competitors, HQ Trivia lessons, regulation, tech/cost context, sources | Founder, PM |
| 02 | [PRD](02-PRD.md) | Problem, goals, personas, MVP / v1.1 / v2 scope, user stories with acceptance criteria, NFRs, release criteria | PM, everyone |
| 03 | [Game Design Document](03-game-design-document.md) | Modes, scoring formula, Glicko-2 tiers, economy, lifelines, cosmetics, difficulty calibration, tone | Design, engineering |
| 04 | [Content Strategy & Question Bible](04-content-strategy-and-question-bible.md) | Categories, editorial rules, pipeline, writer economics, rights, localisation, LiveOps calendar | Content |
| 05 | [UX & User Flows](05-UX-and-user-flows.md) | IA, flows (mermaid), screen specs, microcopy (EN/Pidgin), low-data UX, accessibility, design tokens | Design, mobile |
| 06 | [TRD](06-TRD.md) | Stack decisions, functional requirements per subsystem, timing/anti-cheat design, NFR budgets | Engineering |
| 07 | [System Architecture](07-system-architecture.md) | Diagram, components, monorepo layout, runtime flows, deployment, cost estimate, resilience | Engineering |
| 08 | [Data Model](08-data-model.md) | ERD, entity notes, Redis keyspace, retention, sizing | Backend |
| 09 | [API & Realtime Protocol](09-API-and-realtime-protocol.md) | REST endpoints, examples, Colyseus room state and messages, push, deep links | Backend, mobile |
| 10 | [Security, Anti-Cheat, Privacy & Compliance](10-security-anti-cheat-privacy-compliance.md) | Threat model, anti-cheat, NDPA/GAID checklist, children, prizes vs Play policy, ARCON | Founder, tech lead, DPO |
| 11 | [Monetisation & Business Model](11-monetization-and-business-model.md) | Revenue streams, Naira price points, unit economics, sponsorship rate card | Founder |
| 12 | [Go-To-Market](12-go-to-market.md) | Phased launch, WhatsApp/TikTok/campus channels, ASO, KPIs, budget | Growth |
| 13 | [Analytics & Metrics](13-analytics-and-metrics.md) | Metric tree, event taxonomy, dashboards, experiments | PM, data |
| 14 | [Testing & QA Plan](14-testing-and-QA-plan.md) | Test pyramid, device/network matrix, high-risk test cases, load tests, release process | QA, engineering |
| 15 | [Roadmap & Delivery Plan](15-roadmap-and-delivery-plan.md) | Gantt, milestones, sprint plan, team, budget to launch | Founder, PM |
| 16 | [Operations & LiveOps](16-operations-and-liveops.md) | LiveOps rhythm, events, support, moderation, on-call runbooks | Ops, content |
| 17 | [Risk Register](17-risk-register.md) | 18 scored risks + assumptions to validate | Founder |
| – | [`Who-Sabi-Complete-Pack.html`](Who-Sabi-Complete-Pack.html) | All 18 docs in one page with a table of contents and rendered diagrams. Open it in any browser | Anyone who doesn't want to read Markdown |
| – | [`schema/schema.sql`](schema/schema.sql) | PostgreSQL 16 DDL (validated: loads cleanly) | Backend |
| – | [`content/seed-questions.csv`](content/seed-questions.csv) | 104 draft questions across 5 categories (need fact-check before going live) | Content |
| – | [`content/csv_to_sql.py`](content/csv_to_sql.py) | Converts the question CSV into SQL inserts for the schema (tested) | Backend, content |

---

## Executive summary

**Market.** Nigeria has about 157M internet subscriptions and 57% broadband penetration (NCC, 2026). Android holds 84% of phones, mostly Tecno, Infinix and itel. WhatsApp is on 95% of smartphones and TikTok is now the largest social platform. Nigerian-made games average a **1.91★** rating on Google Play, so the quality bar is low.

**Gap.** Local trivia today means cash game shows on a fixed schedule (Quiz Money, YTrivia) or once-a-day editorial puzzles (Zikoko GridLocked). Nobody owns *"Naija trivia with my own friends, whenever I want."*

**Product.** It has three modes:
1. **Async 1v1 duels:** 3 rounds × 3 questions, played in turns.
2. **Live party rooms:** up to 50 players; guests join from a WhatsApp link in the browser, no install needed.
3. **Daily Sabi Challenge:** a Wordle-style shareable grid.

Categories are Slang & Pidgin, Nollywood, Music, Food and Mixed Naija. The game is built for budget Android phones and tight data plans: under 25 MB download, under 1 MB per match, and a Data Saver mode.

**Business.** Revenue comes from rewarded ads, coins and cosmetics, the Sabi Pass subscription (₦1,200/month), and **brand-sponsored packs**, which carry the most upside. At about 250k MAU the modelled revenue is about ₦22M a month, around break-even for a 6-person team **if sponsorship works**.

**Compliance by design.** There is **no cash, no wallet and no paid entry**. Google Play bans paid-entry prize games, and since November 2024 Nigeria regulates games of chance state by state. Prizes, if any, are sponsor-funded, free to enter and paid as airtime. The game follows NDPA/GAID with a 13+ rating and a restricted mode with guardian consent for 13–17s.

**Build.** React Native (Expo), a Preact web guest client, Node/Fastify API, Colyseus realtime, PostgreSQL and Redis on AWS. A team of about 5 reaches public launch in about 21 weeks for roughly **₦81M (~US$61k)** including launch marketing. A leaner version costs about ₦40–45M.

---

## Key decisions (and why)
| Decision | Rationale | Doc |
|---|---|---|
| Async duels are the core mode, not a scheduled live show | HQ Trivia's live-only model collapsed; Nigerian networks are patchy | 01 §5, 03 §2 |
| Web join for party guests | The friend in the WhatsApp group shouldn't need a 25 MB install to play one round | 02 US-6, 06 §3 |
| No cash, no wallet | Play policy plus state-level gaming law; trust ("I can't withdraw" complaints) | 10 §4 |
| Correct answer never on the client | Anti-cheat; HQ's bots answered 90% correctly | 06 §5.3, 10 §2 |
| Sponsorship is a primary revenue line | Low local IAP spend and volatile eCPMs | 11 |
| Content pipeline starts in week 2 | 3,000 approved questions is the critical path | 15 §5 |

## Before you start building: week-1 checklist
- [ ] Trademark search for the final name (backups listed in the risk register R15)
- [ ] Register the company's Google Play developer account (organisation) and AdMob
- [ ] Brief a Nigerian lawyer on doc 10 §3–§5 (NDPA, prizes, ARCON)
- [ ] Appoint an outsourced DPO
- [ ] Hire the content lead and the first 5 writers
- [ ] Register the Termii sender ID
- [ ] Secure the domain (e.g. whosabi.ng) and social handles

## Labels used in these docs
- *(inferred)*: our own estimate, to be validated.
- **MVP / v1.1 / v2**: release phases "Jollof", "Suya" and "Pepper Soup".
- **WAT**: West Africa Time (UTC+1), used for all game-day boundaries.
