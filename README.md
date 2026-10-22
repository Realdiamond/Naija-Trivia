# Who Sabi? — Naija trivia with friends

One repository for the game: the Expo app (Android, iOS and web), the backend services and the packages they share. The product and design docs are in [`docs/`](docs/00-README.md); start with the README there.

## Layout

| Path                                             | What it is                                                                                                                                                                               | Status                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`packages/game-rules`](packages/game-rules)     | Pure rules shared by every app and service: scoring, answer timing, option shuffling, Glicko-2 ratings, levels, difficulty calibration, WAT dates and streaks, room codes, the duel flow | Built and tested                           |
| [`packages/shared-types`](packages/shared-types) | API contracts (Zod)                                                                                                                                                                      | Built and tested; grows with each API step |
| [`packages/analytics`](packages/analytics)       | Tracking plan, the client event tracker and server helpers                                                                                                                               | Built and tested                           |
| [`apps/api`](apps/api)                           | Fastify API: guest sign-in, sessions, the first-run taste test and async duels (invite links, tie-breaks, ratings)                                                                       | Built and tested; accounts next (step 1.2) |
| [`apps/ingest`](apps/ingest)                     | Analytics event intake                                                                                                                                                                   | Built and tested                           |
| `apps/app`                                       | Expo app for Android, iOS and the web                                                                                                                                                    | Planned (step 1.4)                         |
| [`docs/`](docs/00-README.md)                     | Product, design and technical docs, schemas and seed questions                                                                                                                           | v1.1                                       |

The full target layout is in [docs/07 §3](docs/07-system-architecture.md). What is built, what comes next and in which order is tracked in the [build plan](docs/19-build-plan.md).

## Getting started

You need Node 22 and pnpm 10 (`corepack enable` gives you the pinned pnpm). For the services you also need Postgres 16 and Redis 7; `docker compose up -d` starts them, plus ClickHouse for analytics.

```sh
pnpm install
pnpm test
```

## Checks

CI runs the same commands on every pull request:

```sh
pnpm format:check   # Prettier
pnpm lint           # ESLint, including the rule that keeps native-only modules out of shared app code
pnpm typecheck      # TypeScript in every package
pnpm test           # Vitest in every package
```
