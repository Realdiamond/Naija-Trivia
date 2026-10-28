# Screen designs

Mockups of every screen in the game, drawn from [05 UX](../05-UX-and-user-flows.md), [03 Game design](../03-game-design-document.md), [11 Monetisation](../11-monetization-and-business-model.md) (prices) and [18 Admin & analytics](../18-admin-console-and-analytics.md). They are designs, not the app: the Expo app is built in step 1.4 of the [build plan](../19-build-plan.md), using these as the reference.

Names, scores and numbers are sample data. Questions come from the seed file, so they are drafts until fact-checked.

## What's here

| Path | What it is |
|---|---|
| [`Who-Sabi-screens.pdf`](Who-Sabi-screens.pdf) | All 32 screens, one page per row below |
| [`screens/`](screens) | Each screen as a PNG at twice phone resolution |
| [`mockups/`](mockups) | The source of each screen (`*.dc.html`) and the canvas layout (`canvas.json`) |
| [`../tools/render-screens.cjs`](../tools/render-screens.cjs) | Rebuilds the PNGs and the PDF from `mockups/` |

## The screens

| Row | Screens |
|---|---|
| 1 · First time and sign-in | 01 splash and language · 02 taste test · 03 taste test result · 04 sign in · 05 phone code · 06 username, avatar and age · 07 find friends |
| 2 · Home and async duels | 08 home · 09 challenge someone · 10 pick a category · 11 question · 12 round review · 13 duel result · 14 share card for WhatsApp Status |
| 3 · Daily, party rooms and practice | 15 play: pick a mode · 16 Daily result · 17 party room: create · 18 party room: lobby · 19 Wahala Round answer reveal · 20 podium · 21 practice packs |
| 4 · Leaderboards, friends, profile and shop | 22 leaderboards · 23 friends · 24 profile · 25 shop · 26 settings · 27 report a question |
| 5 · Web app | 28 duel link in a phone browser · 29 join a party from the link · 30 web app on a computer |
| 6 · Admin console (staff) | 31 Overview · 32 User 360 |

## Changes decided after these were drawn

- **Phone sign-in is off at launch** to save the SMS cost: players use Google, Apple (on iPhone) or play as a guest. Screens 04 and 05 keep the phone design for when it is switched on, and "find friends from contacts" (07) waits for it too.
- **Sport becomes a sixth category.** The category screens still show the original five.

## Rebuilding the images

From the repo root, with Playwright and its Chromium installed:

```sh
node docs/tools/render-screens.cjs docs/design/mockups /tmp/who-sabi-screens
```

It writes `png/*.png` and `Who-Sabi-screens.pdf` into the folder you name. The renderer shows each screen as it first opens; taps and toggles are not part of the images.
