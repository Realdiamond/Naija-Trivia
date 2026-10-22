# 11 · Monetisation & Business Model

**Version:** 1.1 · **Date:** 15 Oct 2026 · FX assumption: **₦1,335 = US$1** (official rate, Oct 2026)
> All figures in this doc are planning estimates *(inferred)*. Replace them with real data after the beta.

---

## 1. Principles
1. **Free to play, fair to play.** Paying can buy looks and convenience, never prize eligibility or rating.
2. **Respect data budgets.** Ads are opt-in (rewarded) or capped, and never interrupt a question.
3. **Brands pay for culture.** Sponsorship is the biggest upside in Nigeria, because local IAP spend is low (27% of Nigerian games use IAP vs 35% globally, per 42matters).

## 2. Revenue streams

| Stream | Mechanic | Launch | Notes |
|---|---|---|---|
| **Rewarded video** | Watch to get a lifeline, coins, or double the Daily coins | MVP | Highest eCPM format. Opt-in, so data-conscious users choose when |
| **Interstitial** | After every 3rd completed match, never in the first session, never for Sabi Pass | MVP | Frequency cap set in remote config |
| **Native banner** | Results screen only (not during gameplay) | MVP | Small revenue, hidden in Data Saver mode |
| **Coin packs (IAP)** | Coins for lifelines and cosmetics | MVP | Google Play billing in Naira |
| **Gems & cosmetics** | Premium outfits, emotes, button skins | v1.1 | Cosmetic only |
| **Web purchases** | Coins, gems and the Sabi Pass bought on whosabi.ng through Paystack (card, bank transfer, USSD) | v1.1 | Paystack charges 1.5% (+ ₦100 from ₦2,500), capped at ₦2,000, against 15% in the stores; same Naira prices everywhere |
| **Web ads** | Rewarded and interstitial ads in the web app (Google H5 Games Ads / Ad Manager) | v1.1 | Same caps and rules as the app; usually a lower eCPM than in-app |
| **Sabi Pass (subscription)** | No interstitials, 2× Daily coins, exclusive monthly cosmetic, 50-player rooms, unlimited duels, stats deep-dive | v1.1 | Monthly or yearly |
| **Sponsored packs & events** | Branded question pack + home takeover + share-card branding + free-to-enter airtime drop | v2 (pilot in v1.1) | B2B sales |
| **Campus Clash sponsorship** | Title sponsor of the inter-university season | v2 | Telcos, fintechs, FMCG |
| **Licensing (later)** | White-label trivia rooms for corporate events, radio/TV quiz segments | v2+ | |

## 3. Price points (Google Play Naira tiers; final tiers depend on Play's local price templates)

| SKU | Contents | Price |
|---|---|---|
| `coins_small` | 500 coins | ₦300 |
| `coins_medium` | 1,500 coins (+20%) | ₦800 |
| `coins_large` | 3,500 coins (+40%) | ₦1,500 |
| `coins_mega` | 9,000 coins (+60%) | ₦3,500 |
| `starter_pack` (once only, first 72 h) | 1,000 coins + "JJC No More" outfit | ₦500 |
| `sabi_pass_monthly` | Pass benefits | ₦1,200 / month |
| `sabi_pass_yearly` | Pass benefits + exclusive "Founding Sabi" frame | ₦9,900 / year (−31%) |
| Gems 100 / 300 / 1,000 | Premium cosmetics | ₦500 / ₦1,300 / ₦3,900 |

FunBox (a comparable Nigerian social game) prices packs at ₦500, ₦1,200 and ₦3,500, which supports these anchors.

**Web prices (v1.1)** are the same Naira prices, paid through Paystack. A ₦1,200 Sabi Pass nets about ₦1,182 on the web (1.5%; the ₦100 flat fee only applies from ₦2,500) against ₦1,020 through the stores. The apps never point players to the web price (store anti-steering rules).

Store fees: 15% on subscriptions and on the first US$1M of yearly revenue through the Google Play and Apple small-business programmes.

## 4. Unit economics model (steady state, month 9)

### Assumptions
| Input | Value |
|---|---|
| MAU | 250,000 |
| DAU/MAU | 30% → 75,000 DAU |
| Rewarded views per DAU | 1.5 |
| Rewarded eCPM (NG, mediated) | US$1.50 |
| Interstitials per DAU | 0.8 |
| Interstitial eCPM | US$0.80 |
| Banner impressions per DAU / eCPM | 3 / US$0.10 |
| IAP payer conversion (monthly, of MAU) | 1.0% |
| IAP ARPPU (monthly) | ₦2,000 |
| Sabi Pass subscribers (of MAU) | 0.8% |
| Sponsorship deals per month | 2 × ₦3,000,000 |

### Monthly revenue
| Stream | Calculation | ₦ / month |
|---|---|---|
| Rewarded | 75k × 30 × 1.5 / 1000 × $1.50 × 1,335 | ₦6.76M |
| Interstitial | 75k × 30 × 0.8 / 1000 × $0.80 × 1,335 | ₦1.92M |
| Banner | 75k × 30 × 3 / 1000 × $0.10 × 1,335 | ₦0.90M |
| IAP (net of 15%) | 250k × 1% × ₦2,000 × 0.85 | ₦4.25M |
| Sabi Pass (net of 15%) | 250k × 0.8% × ₦1,200 × 0.85 | ₦2.04M |
| Sponsorship | 2 × ₦3M | ₦6.00M |
| **Total** | | **≈ ₦21.9M (~US$16.4k)** |
| **ARPDAU** | ₦21.9M / (75k × 30) | **≈ ₦9.7** |

### Monthly costs (same scale)
| Item | ₦ / month |
|---|---|
| Infrastructure + OTP + tools | ₦3.0M (scaled from the MVP estimate in doc 07, including the analytics store) |
| Content (writers, editor) | ₦1.2M |
| Team (6 people: PM/founder, 3 engineers, designer, community/content lead) | ₦12–18M |
| Marketing (creators, campus) | ₦3–5M |
| **Total** | **≈ ₦19–27M** |

**Read:** the business can break even at about 250k MAU **if sponsorship works**. Without sponsorship, ARPDAU falls to about ₦7 and the business needs about 400k MAU or a leaner team. **Sponsorship sales is a must-have hire by v1.1.**

Web purchases and web ads are not in this model yet, so they are upside. Every Naira of spend that moves from the stores to Paystack keeps up to about 16% more net revenue (98.5% against 85%) *(inferred)*.

### Sensitivity
| Lever | +/- effect on monthly revenue |
|---|---|
| Rewarded views/DAU 1.5 → 2.0 | +₦2.25M |
| Sponsorship 2 → 4 deals | +₦6M |
| Payer conversion 1% → 1.5% | +₦2.1M |
| eCPMs −30% (ad market softness) | −₦2.9M |

## 5. Sponsorship product (rate card draft)

| Package | Includes | Price (₦) |
|---|---|---|
| **Flash Pack** (1 week) | 50-question branded pack, home banner 3 days, branded share card | 1,500,000 |
| **Takeover** (2 weeks) | Flash Pack + branded Daily for 7 days + push (1×) + creator collab (2 creators) + results report | 3,500,000 |
| **Campus Clash Title** (season, 8 weeks) | Naming rights, trophy, campus activations in 10 schools, free-to-enter airtime prizes funded by the sponsor | 15,000,000+ |
| **Event Night** | Live party room hosted by a celebrity (e.g. AMVCA or Headies night), branded | 2,000,000 |

Reporting for brands: players reached, questions answered, average time in pack, share-card shares, and brand-recall question accuracy (pre/post questions such as "Which brand launched X?").

**Target sponsor categories:** telcos (MTN, Airtel, Glo), fintechs (Moniepoint, OPay, PalmPay, Kuda), FMCG (noodles, beverages, seasoning), streaming (Showmax, Prime Video, Netflix Naija originals), film distributors (FilmOne), music labels. **Excluded:** betting, alcohol (unless 18+-gated and counsel-approved), political parties, crypto.

## 6. Pricing experiments (with our own flags, managed in the admin console)
1. Starter pack at ₦500 vs ₦300.
2. Sabi Pass at ₦1,000 vs ₦1,200 vs ₦1,500 a month.
3. Rewarded lifeline: 1 ad vs 60 coins.
4. Interstitial every 3 vs 4 matches (watch D7 retention as the guardrail).

## 7. What we will NOT do
- Entry fees, cash tournaments, wallets, withdrawals (legal and Play policy risk, see doc 10).
- Selling or sharing player data. Sponsors only ever see aggregate brand reports.
- Betting-company ads or partnerships.
- Pay-to-win (purchases affecting rating or ranked results).
