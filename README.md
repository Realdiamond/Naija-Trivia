# Who Sabi? — Naija trivia with friends

One repository for the game: the Expo app (Android, iOS and web), the backend services and the packages they share. The product and design docs are in [`docs/`](docs/00-README.md); start with the README there.

## Layout

| Path                                             | What it is                                                                                                                                                                                        | Status                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`packages/game-rules`](packages/game-rules)     | Pure rules shared by every app and service: scoring, answer timing, option shuffling, Glicko-2 ratings, levels, difficulty calibration, WAT dates and streaks, room codes, the duel flow          | Built and tested                           |
| [`packages/shared-types`](packages/shared-types) | API contracts (Zod)                                                                                                                                                                               | Built and tested; grows with each API step |
| [`packages/analytics`](packages/analytics)       | Tracking plan, the client event tracker and server helpers                                                                                                                                        | Built and tested                           |
| [`apps/api`](apps/api)                           | Fastify API: sign-in (guest, phone, Google, Apple), profiles, friends and blocks, the taste test and async duels, plus its worker (duel expiry, turn reminders, question stats, analytics loader) | Built and tested                           |
| [`apps/ingest`](apps/ingest)                     | Analytics event intake                                                                                                                                                                            | Built and tested                           |
| [`apps/admin`](apps/admin)                       | Staff admin console (Next.js): Google sign-in, roles, player search, User 360 with the activity timeline, the audit log                                                                           | Built and tested (v0, step 1.5)            |
| [`apps/app`](apps/app)                           | Expo app (Expo Router) for Android, iOS and the web: welcome, taste test, sign-in, profile, home, duels, duel links, friends, keyboard play and the desktop layout                                | Built and tested (step 1.4)                |
| [`docs/`](docs/00-README.md)                     | Product, design and technical docs, schemas and seed questions                                                                                                                                    | v1.1                                       |

The full target layout is in [docs/07 §3](docs/07-system-architecture.md). What is built, what comes next and in which order is tracked in the [build plan](docs/19-build-plan.md).

## Getting started

You need Node 22 and pnpm 10 (`corepack enable` gives you the pinned pnpm). For the services you also need Postgres 16 and Redis 7; `docker compose up -d` starts them, plus ClickHouse for analytics.

```sh
pnpm install
pnpm test
```

### Running the app

```sh
cp apps/api/.env.example apps/api/.env
pnpm --filter @whosabi/api db:seed --live   # the seed questions, playable at once (development only)
pnpm --filter @whosabi/api dev              # the API on http://localhost:3000
pnpm --filter @whosabi/app web              # the app in the browser on http://localhost:8081
```

The admin console: add yourself as an owner, then run it and sign in with the development form.

```sh
pnpm --filter @whosabi/api admin:add you@example.com "Your Name" owner
cp apps/admin/.env.example apps/admin/.env.local
pnpm --filter @whosabi/admin dev            # the console on http://localhost:3002
```

Sign-in codes are not texted in development: the API writes them to its log. To try the app on an Android phone with Expo Go, copy `apps/app/.env.example` to `apps/app/.env`, set `EXPO_PUBLIC_API_URL` to your computer's address on the Wi-Fi (like `http://192.168.1.20:3000`), run `pnpm --filter @whosabi/app dev` and scan the QR code.

## Deploying

Staging runs on Heroku: two apps from this repository (the game and the admin console). The step-by-step guide is [docs/deploy/heroku.md](docs/deploy/heroku.md).

## Checks

CI runs the same commands on every pull request:

```sh
pnpm format:check   # Prettier
pnpm lint           # ESLint, including the rule that keeps native-only modules out of shared app code
pnpm typecheck      # TypeScript in every package
pnpm test           # Vitest in every package
```

CI also builds the web app and the admin console and runs their end-to-end tests: Playwright drives them in Chromium against the real API (`apps/app/e2e`, `apps/admin/e2e`). Locally, with Postgres and Redis running:

```sh
EXPO_PUBLIC_API_URL=http://localhost:3100 pnpm --filter @whosabi/app build:web
TEST_PG_ADMIN_URL=postgres://whosabi:whosabi@localhost:5432/whosabi pnpm --filter @whosabi/app e2e
```
