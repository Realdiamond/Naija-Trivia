# Deploying Who Sabi? to Heroku (staging)

**Build plan step 1.6.** This guide sets up a staging copy of the game on Heroku in the Europe region, so the team can play it on real phones and computers before launch. It takes about an hour the first time. Nothing here needs a developer; you need a Heroku account with a payment card, and a terminal.

## What you will have

Two Heroku apps built from this one repository:

| Heroku app | What it runs | Address (example) |
|---|---|---|
| **Game** (`WHOSABI_APP=game`) | `web`: the API, which also serves the web app and takes the analytics events; `worker`: duel expiry, turn reminders, question stats, analytics loading. Migrations run on every release | `https://whosabi-staging-1234.herokuapp.com` |
| **Admin** (`WHOSABI_APP=admin`) | `web`: the staff admin console | `https://whosabi-admin-staging-5678.herokuapp.com` |

The web app and the API share one address on purpose: the sign-in cookie only works when they do, and `herokuapp.com` treats every app as a separate site.

**Monthly cost, roughly** (check [Heroku pricing](https://www.heroku.com/pricing), it changes): 3 Basic dynos (game web, game worker, admin web) at about US$7 each, Heroku Postgres Essential-0 at about US$5, and Heroku Key-Value Store Mini at about US$3. **About US$29 a month** in total. Eco dynos are cheaper but sleep when idle, which stops the worker.

## Before you start

1. A Heroku account with billing turned on: <https://signup.heroku.com>.
2. The Heroku CLI on your computer: <https://devcenter.heroku.com/articles/heroku-cli>, then `heroku login`.
3. This repository on your computer (`git clone https://github.com/Realdiamond/Naija-Trivia.git`), with Node 22 and pnpm (`corepack enable`), so you can make the secret keys in step 2.
4. **For the admin console:** a Google OAuth "Web application" client ID (free) from the [Google Cloud Console](https://console.cloud.google.com/apis/credentials). Add the admin app's address (from step 5) under *Authorized JavaScript origins*. Players can still play without Google: as guests, and through duel links.

## 1. Create the game app

```sh
heroku create whosabi-staging --region eu
heroku addons:create heroku-postgresql:essential-0 --app whosabi-staging
heroku addons:create heroku-redis:mini --app whosabi-staging
heroku buildpacks:set heroku/nodejs --app whosabi-staging
```

If the name is taken, Heroku says so; pick another and use it everywhere below. `heroku apps:info --app whosabi-staging` shows the app's address ("Web URL").

## 2. Set its settings

Make the secret keys on your computer, from the repository folder:

```sh
pnpm install
pnpm --filter @whosabi/api keys whosabi-staging
```

It prints a `heroku config:set …` command with a new key pair and analytics key. **Run that command as printed**, and keep it private. Then set the rest, using your app's address:

```sh
heroku config:set --app whosabi-staging \
  WHOSABI_APP=game NODE_ENV=production \
  PGSSLMODE=no-verify REDIS_TLS_VERIFY=false EVENTS_IN_API=true \
  PUBLIC_WEB_URL=https://whosabi-staging-1234.herokuapp.com \
  CORS_ORIGINS=https://whosabi-staging-1234.herokuapp.com
```

| Setting | Why |
|---|---|
| `PGSSLMODE=no-verify`, `REDIS_TLS_VERIFY=false` | Heroku's database and Redis use encrypted connections with certificates Node can't check |
| `EVENTS_IN_API=true` | The API takes the app's analytics events itself, so there is no separate ingest app to pay for |
| `PUBLIC_WEB_URL`, `CORS_ORIGINS` | The app's own address: duel links and link previews use it, and the sign-in cookie only refreshes from it |

Optional, for Google sign-in for players (both the same web client ID; Android and iOS client IDs join the first list later):

```sh
heroku config:set --app whosabi-staging \
  GOOGLE_CLIENT_IDS=1234-abc.apps.googleusercontent.com \
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=1234-abc.apps.googleusercontent.com
```

`EXPO_PUBLIC_…` settings are built into the web app, so change them before deploying, or deploy again after.

## 3. Deploy

Either connect GitHub in the Heroku dashboard (the app's **Deploy** tab → GitHub → this repository → **Enable Automatic Deploys** from `main`, then **Deploy Branch**), or push from your computer:

```sh
heroku git:remote --app whosabi-staging
git push heroku main
```

The build installs everything, builds the API and the web app, and then runs the database migrations (the release phase). It takes about 5–10 minutes. Then start both processes:

```sh
heroku ps:scale web=1:basic worker=1:basic --app whosabi-staging
```

Open the app's address: you should see the green welcome screen.

## 4. Questions and the first staff owner

The questions in the repository are drafts until the team checks them (doc 04). To play them on staging anyway:

```sh
heroku run --app whosabi-staging \
  "cd apps/api && SEED_LIVE_ALLOWED=yes node dist/scripts/seed.js --live"
```

The Daily needs at least 7 live questions, so it appears once this has run. Never set `SEED_LIVE_ALLOWED` on the real production app. On production, questions arrive through the admin console instead: **Import** takes a category file from the question bank, a fact-checker approves each question under **Questions**, and an editor publishes them. Then make yourself the first owner of the admin console, with the Google account you will sign in with:

```sh
heroku run --app whosabi-staging \
  "cd apps/api && node dist/scripts/admin-add.js you@gmail.com 'Your Name' owner"
```

## 5. Create the admin app

```sh
heroku create whosabi-admin-staging --region eu
heroku buildpacks:set heroku/nodejs --app whosabi-admin-staging
heroku config:set --app whosabi-admin-staging \
  WHOSABI_APP=admin NODE_ENV=production \
  API_URL=https://whosabi-staging-1234.herokuapp.com \
  ADMIN_GOOGLE_CLIENT_ID=5678-xyz.apps.googleusercontent.com
heroku config:set --app whosabi-staging ADMIN_GOOGLE_CLIENT_IDS=5678-xyz.apps.googleusercontent.com
```

The last line tells the API to accept that Google client for staff. If your team uses Google Workspace, also set `ADMIN_GOOGLE_DOMAIN=yourdomain.com` on the game app, so only Workspace accounts get in.

Deploy the same repository to it (GitHub in the dashboard, or `git push` to its own remote) and start it:

```sh
heroku git:remote --app whosabi-admin-staging --remote heroku-admin
git push heroku-admin main
heroku ps:scale web=1:basic --app whosabi-admin-staging
```

Open its address and sign in with Google. Add more staff on **Staff and roles**.

## 6. Try it

- **Two players, one duel (the M1 goal):** open the game's address on a computer, tap **Start playing**, then **Challenge a friend → Send a duel link**, play round 1 and send the link on WhatsApp to a phone. Open it on the phone, accept, and take turns until the result.
- **The Android app:** on your computer, `cd apps/app`, put `EXPO_PUBLIC_API_URL=https://whosabi-staging-1234.herokuapp.com` in `.env`, run `pnpm dev`, and scan the QR code with Expo Go on an Android phone.
- **The Daily:** the orange card on Home opens today's 7 questions. Play them, share the grid on WhatsApp, and open **Leaderboards** (the trophy). A new Daily starts at midnight, Nigerian time; the worker picks it at 23:00.
- **Link previews and pictures:** paste a duel link into a WhatsApp chat: the preview shows who sent the challenge. After a duel or a Daily, **Share picture for Status** makes the picture for WhatsApp Status (on a computer it downloads).
- **The admin console:** search the player's username or user ID; their timeline shows the game within a minute or two.

## When something goes wrong

| What you see | What to do |
|---|---|
| The build fails | `heroku builds:output --app <app>` shows why. Most often a missing setting from step 2 |
| "Release failed" | The migrations failed: `heroku releases:output --app whosabi-staging` |
| The site shows "Application error" | `heroku logs --tail --app <app>`. `Missing required production settings` means a key from step 2 is missing |
| Signed out on every reload | `PUBLIC_WEB_URL` and `CORS_ORIGINS` must be exactly the address in the browser, with `https://` and no slash at the end |
| No questions | Run the seed command in step 4 |
| The admin console says "No access" | That Google account is not on the staff list: run `admin-add.js` from step 4 for it |
| The slug is too big (over 500 MB) | Not expected: a rehearsal of the Heroku build measured about 290 MB for the game app and 320 MB for the admin app. If it happens, tell the developers: the fix is a slimmer install for each app |

## Later

- **Real production:** the same steps on new apps (for example `whosabi` and `whosabi-admin`), with new keys from step 2 and **without** `SEED_LIVE_ALLOWED`. Questions go live through the content workflow (step 2.6).
- **Your own domain:** `heroku domains:add whosabi.ng --app whosabi`, then update `PUBLIC_WEB_URL` and `CORS_ORIGINS`. The Android app opens `whosabi.ng` links itself; for another domain, build the app with `LINK_HOST` set to it.
- **Staff tools on your phone:** make sure you are on the staff list as owner or admin (step 4), then in the Android app sign in with Google using that same email. A shield appears on Home: tap it, choose the same Google account again, and use your fingerprint or PIN from then on. The phone stays signed in for 30 days; **Staff phones** in the console lists it and can sign it out if the phone is lost.
- **Push notifications:** in Firebase, **Project settings → Service accounts → Generate new private key** downloads a JSON file. It is a secret: don't send it to anyone. In the Heroku dashboard, open the game app, **Settings → Reveal Config Vars**, add `FIREBASE_SERVICE_ACCOUNT` and paste the whole file as its value (or `heroku config:set FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" --app whosabi-staging`), then delete the file from your computer. The worker sends real pushes from then on; until then it writes them to its log.
- **Links that open the Android app:** in Play Console, **Test and release → App integrity → App signing**, copy the **SHA-256** certificate fingerprint (it is public, not a secret) and set `ANDROID_CERT_SHA256` to it (several, comma-separated, for an upload key too). The API then serves `/.well-known/assetlinks.json`, and challenge, duel and Daily links open in the app when it is installed. `APPLE_TEAM_ID` does the same for iOS later.
- **Phone sign-in:** set the Termii or Africa's Talking keys plus `OTP_SECRET` and `TURNSTILE_SECRET` (build plan §6).
- **Bigger:** more `web` dynos (`heroku ps:scale web=2`), a bigger Postgres plan, and the separate ingest service when events grow (set `EVENTS_IN_API=false` and point the app's `EXPO_PUBLIC_EVENTS_URL` at it).
